// src/pages/Checkout/Checkout.js - Complete version with dynamic product integration

/* eslint-disable no-unused-vars */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Navbar from '../../components/layout/Navbar/Navbar';
import Footer from '../../components/sections/Footer/Footer';
import AuthModal from '../../components/auth/AuthModal';
import PricingCards from '../../components/PricingCards/PricingCards';
import { onAuthChange, registerUser } from '../../firebase/authService';
import { processPayment, processStripePayment } from '../../services/paymentService';
import StripeWrapper from '../../components/payment/StripeWrapper';
import { 
  getFirestore, 
  doc, 
  addDoc, 
  collection, 
  getDoc, 
  updateDoc,
  getDocs,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import userService from '../../services/userService';
import { v4 as uuidv4 } from 'uuid';
import { countries } from '../../utils/countries';
import app from '../../firebase/config';
import './Checkout.scss';

const Checkout = () => {
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const mode = queryParams.get('mode');
  const initialPlan = queryParams.get('plan') || 'cheatsheet';
  
  // State management
  const [selectedPlan, setSelectedPlan] = useState(initialPlan);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [couponCode, setCouponCode] = useState('');
  const [showCouponInput, setShowCouponInput] = useState(false);
  const [couponApplied, setCouponApplied] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [user, setUser] = useState(null);
  const [checkoutStep, setCheckoutStep] = useState('plan'); // 'plan', 'payment', 'review', 'confirmation'
  const [previousStep, setPreviousStep] = useState(null);
  const [cardInfo, setCardInfo] = useState({
    number: '',
    expiry: '',
    cvc: '',
    name: '',
    email: '',
    cardType: null
  });
  const [discountCodes] = useState({
    'PREMEDVIP': { rate: 10, description: 'VIP Discount' },
    'STUDENT2025': { rate: 20, description: 'Student Discount' },
    'PARTNER': { rate: 100, description: 'Partnership - 100% Off' },
    'COOLMEMBER': { rate: 100, description: 'Cool Member - 100% Off' }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(mode === 'login');
  const [isLoginMode, setIsLoginMode] = useState(mode === 'login');
  const [useStripe, setUseStripe] = useState(true); // Default to using Stripe
  const [subscription, setSubscription] = useState({
    type: 'onetime',
    price: 14.99
  });
  const [pendingUserData, setPendingUserData] = useState(null);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [savePaymentMethod, setSavePaymentMethod] = useState(false);
  const [saveAddress, setSaveAddress] = useState(false);
  const [billingAddress, setBillingAddress] = useState({
    name: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'United States'
  });
  const stripeWrapperRef = useRef(null);
  
  const navigate = useNavigate();
  const db = getFirestore(app);

  // Load products from Firestore
  useEffect(() => {
    const loadProducts = async () => {
      try {
        setProductsLoading(true);
        
        // Query active products, ordered by sortOrder then by name
        const q = query(
          collection(db, 'products'),
          where('isActive', '==', true),
          orderBy('sortOrder', 'asc')
        );
        
        const querySnapshot = await getDocs(q);
        const productsData = [];
        
        querySnapshot.forEach((doc) => {
          const productData = { id: doc.id, ...doc.data() };
          productsData.push(productData);
        });

        // If no products found, fall back to default products
        if (productsData.length === 0) {
          console.warn('No products found in Firestore, using default products');
          setProducts(getDefaultProducts());
        } else {
          setProducts(productsData);
        }

        // If there's a pre-selected plan, find the corresponding product
        if (initialPlan && productsData.length > 0) {
          const product = productsData.find(p => p.id === initialPlan);
          if (product) {
            setSelectedProduct(product);
            setSubscription({
              type: 'onetime',
              price: product.price
            });
          } else {
            // Fall back to legacy plan handling
            handleLegacyPlan(initialPlan);
          }
        }
      } catch (error) {
        console.error('Error loading products:', error);
        setProducts(getDefaultProducts());
        handleLegacyPlan(initialPlan);
      } finally {
        setProductsLoading(false);
      }
    };

    loadProducts();
  }, [initialPlan, db]);

  // Default products as fallback
  const getDefaultProducts = () => {
    return [
      {
        id: 'cheatsheet',
        name: 'The Cheatsheet',
        price: 14.99,
        description: 'New full applicant profile added every couple days.',
        features: [
          'Advice and reflections from successful applicants',
          'Which medical schools an applicant was accepted',
          'Extra-curriculars that got them in',
          'MCAT and GPA that got them in',
          'Gap years they took'
        ],
        category: 'cheatsheet',
        isActive: true,
        sortOrder: 1
      },
      {
        id: 'application',
        name: 'Application Cheatsheet',
        price: 19.99,
        description: '',
        features: [
          'Personal statement writing guide',
          'Activity section description guide',
          'Insider advice on what admissions committees want',
          'General writing strategy guide',
          'Letter of recommendation email template'
        ],
        category: 'application',
        isActive: true,
        sortOrder: 2
      },
      {
        id: 'cheatsheet-plus',
        name: 'The Cheatsheet +',
        price: 29.99,
        description: 'Get everything in the Premed Cheatsheet + extra resources. New full applicant profile added every couple days.',
        features: [
          'The Premed Cheatsheet',
          'Proven cold emailing templates',
          'Polished CV template',
          'Pre-med summer program database',
          'MCAT-Optimized Course Schedules & Study Plan'
        ],
        category: 'cheatsheet',
        isActive: true,
        sortOrder: 3
      },
      {
        id: 'application-plus',
        name: 'Application Cheatsheet +',
        price: 34.99,
        description: 'Get everything in the Premed Cheatsheet + Application Cheatsheet. New full applicant profile added every couple days.',
        features: [
          'The Premed Cheatsheet',
          'The Application Cheatsheet'
        ],
        category: 'application',
        isActive: true,
        sortOrder: 4
      }
    ];
  };

  // Handle legacy plan IDs for backward compatibility
  const handleLegacyPlan = (planId) => {
    switch(planId) {
      case 'cheatsheet':
        setSubscription({ type: 'onetime', price: 14.99 });
        break;
      case 'cheatsheet-plus':
        setSubscription({ type: 'onetime', price: 29.99 });
        break;
      case 'application':
        setSubscription({ type: 'onetime', price: 19.99 });
        break;
      case 'application-plus':
        setSubscription({ type: 'onetime', price: 34.99 });
        break;
      default:
        setSubscription({ type: 'onetime', price: 14.99 });
    }
  };

  // Add this useEffect hook to set up the Stripe wrapper
  useEffect(() => {
    // Make the ref accessible globally for easier debugging
    window.stripeWrapperRef = stripeWrapperRef;
    
    // Cleanup function to remove the ref when component unmounts
    return () => {
      delete window.stripeWrapperRef;
    };
  }, []);

  // Add this new useEffect to reset loading when modal closes
  useEffect(() => {
    // Clear loading state when modal is dismissed
    if (!showAuthModal) {
      setLoading(false);
      setError('');
    }
  }, [showAuthModal]);

  // Check for authenticated user on component mount
  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      console.log("Auth state changed:", currentUser);
      setUser(currentUser);
      
      // If the user signs in and we're on the payment step, update the email field
      if (currentUser && currentUser.email && checkoutStep === 'payment') {
        setCardInfo(prev => ({
          ...prev,
          email: currentUser.email
        }));
      }
    });

    return () => unsubscribe();
  }, [checkoutStep]);

  // Handle URL parameters for authentication mode
  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const isUpgrade = urlParams.get('upgrade') === 'true';
    
    // If this is an upgrade and user is logged in, NEVER show auth modal
    if (isUpgrade && user) {
      console.log("Upgrade detected for logged in user - skipping auth modal");
      setShowAuthModal(false); // Force close any modal
      setCheckoutStep('payment');
      return;
    }
    
    // Only show auth modal for non-upgrade flows
    if (!isUpgrade) {
      if (mode === 'login') {
        setShowAuthModal(true);
        setIsLoginMode(true);
      } else if (mode === 'signup') {
        setShowAuthModal(true);
        setIsLoginMode(false);
      }
    }
  }, [mode, user, location.search]);

  useEffect(() => {
    const urlParams = new URLSearchParams(location.search);
    const preSelectedPlan = urlParams.get('plan');
    const isUpgrade = urlParams.get('upgrade') === 'true';
    
    // If user is authenticated and this is an upgrade, skip straight to payment
    if (user && isUpgrade && preSelectedPlan && checkoutStep === 'plan') {
      setSelectedPlan(preSelectedPlan);
      setCheckoutStep('payment');
    }
  }, [user, location.search, checkoutStep]);

  // Redirect to profile after confirmation
  useEffect(() => {
    if (checkoutStep === 'confirmation' && orderId) {
      const timer = setTimeout(() => {
        navigate('/profile');
      }, 3000);
      
      return () => clearTimeout(timer);
    }
  }, [checkoutStep, orderId, navigate]);

  // Add this function with your other handlers
  const handleAddressChange = (e) => {
    const { name, value } = e.target;
    setBillingAddress(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Proper step change that records previous step for back navigation
  const changeCheckoutStep = (newStep) => {
    setPreviousStep(checkoutStep);
    setCheckoutStep(newStep);
    console.log(`Changing from ${checkoutStep} to ${newStep}, previous step saved as ${checkoutStep}`);
  };

  // Proper back navigation that uses previous step
  const handleGoBack = () => {
    console.log("Back button pressed, current step:", checkoutStep, "previous step:", previousStep);
    
    // Reset all modal and loading states when going back
    setShowAuthModal(false);
    setLoading(false);
    setError('');
    
    // If we're on payment, go back to plan selection
    if (checkoutStep === 'payment') {
      setCheckoutStep('plan');
    }
    // If we're on review, go back to payment
    else if (checkoutStep === 'review') {
      setCheckoutStep('payment');
    }
    else {
      navigate(-1); // Use browser navigation as fallback
    }
  };

  // Handle plan selection with product data
  const handleSelectPlan = (planId, couponInfo = {}) => {
    const product = products.find(p => p.id === planId);
    if (!product) {
      console.error('Product not found:', planId);
      // Fall back to legacy handling
      setSelectedPlan(planId);
      handleLegacyPlan(planId);
    } else {
      setSelectedPlan(planId);
      setSelectedProduct(product);
      
      // Set subscription details from product
      setSubscription({
        type: 'onetime',
        price: product.price
      });
    }
    
    // Apply any coupon info passed from pricing card component
    if (couponInfo.couponCode) {
      setCouponCode(couponInfo.couponCode);
      setDiscount(couponInfo.discount);
      setCouponApplied(true);
    } else {
      // Reset coupon when plan changes without coupon info
      setCouponApplied(false);
      setCouponCode('');
      setDiscount(0);
    }
    
    setPreviousStep('plan');
    
    // Store the plan selection in URL parameters for easy recovery
    const searchParams = new URLSearchParams(location.search);
    searchParams.set('plan', planId);
    navigate({
      pathname: location.pathname,
      search: searchParams.toString()
    }, { replace: true });
  };

  // New function to handle when user wants to proceed to payment
  const handleProceedToPayment = (planId, couponInfo = {}) => {
    const product = products.find(p => p.id === planId);
    
    if (product) {
      setSelectedPlan(planId);
      setSelectedProduct(product);
      setSubscription({
        type: 'onetime',
        price: product.price
      });
    } else {
      // Fallback for legacy plans
      setSelectedPlan(planId);
      handleLegacyPlan(planId);
    }

    // Apply coupon info if provided
    if (couponInfo.couponCode) {
      setCouponCode(couponInfo.couponCode);
      setDiscount(couponInfo.discount);
      setCouponApplied(true);
    }
    
    const urlParams = new URLSearchParams(location.search);
    const isUpgrade = urlParams.get('upgrade') === 'true';
    
    // Force skip auth modal for upgrades
    if (isUpgrade || user) {
      console.log("Skipping auth modal - upgrade or authenticated user");
      setShowAuthModal(false);
      setCheckoutStep('payment');
      return;
    }
    
    // Only show auth modal for completely new users
    if (!user && !pendingUserData && !isUpgrade) {
      setShowAuthModal(true);
      setIsLoginMode(false);
    } else {
      setCheckoutStep('payment');
    }
  };

  // Toggle coupon input visibility
  const toggleCouponInput = () => {
    setShowCouponInput(!showCouponInput);
  };

  // Apply coupon function
  const applyCoupon = () => {
    if (!couponCode.trim()) {
      alert('Please enter a coupon code');
      return;
    }
    
    // Convert to uppercase for case-insensitive comparison
    const code = couponCode.toUpperCase();
    
    if (discountCodes[code]) {
      setCouponApplied(true);
      setDiscount(discountCodes[code].rate);
      alert(`Coupon applied! ${discountCodes[code].description} (${discountCodes[code].rate}% off)`);
    } else {
      alert('Invalid coupon code. Please try again.');
    }
  };

  // Function to remove applied coupon
  const removeCoupon = () => {
    setCouponApplied(false);
    setCouponCode('');
    setDiscount(0);
  };

  // Calculate prices including any discounts
  const getBasePrice = () => {
    if (selectedProduct) {
      return selectedProduct.price;
    }
    return subscription.price;
  };

  const getDiscountAmount = () => {
    const basePrice = getBasePrice();
    return (basePrice * discount) / 100;
  };

  const getFinalPrice = () => {
    const basePrice = getBasePrice();
    if (couponApplied) {
      const discountAmount = getDiscountAmount();
      const finalPrice = basePrice - discountAmount;
      return finalPrice <= 0 ? 0 : finalPrice.toFixed(2);
    }
    return basePrice.toFixed(2);
  };

  // Check if purchase is free with 100% discount coupon
  const isFreeWithCoupon = () => {
    return couponApplied && discount === 100;
  };

  const handleCloseAuthModal = () => {
    // Set a flag in session storage to prevent immediate reopening
    sessionStorage.setItem('modalJustClosed', 'true');
    setShowAuthModal(false);
    setLoading(false);
    setError('');
    
    // IMPORTANT: Reset the checkout step back to 'plan'
    setCheckoutStep('plan');
    
    // Clear any pending user data
    setPendingUserData(null);
    setRegistrationComplete(false);
    
    // Force a longer delay before allowing modal to show again
    setTimeout(() => {
      sessionStorage.removeItem('modalJustClosed');
    }, 2000);
  };

  // Process a free purchase with 100% discount coupon
  const processFreePurchase = async () => {
    setLoading(true);
    setError('');
    
    try {
      console.log("Starting free purchase process");
      
      // Check if we're dealing with a logged-in user or pending user data
      if (!user && pendingUserData) {
        console.log("Creating new user account from pending data for free purchase");
        
        // Create the user account from pending data
        const registrationResult = await registerUser(
          pendingUserData.email,
          pendingUserData.password,
          pendingUserData.firstName,
          pendingUserData.lastName
        );
        
        if (!registrationResult.success) {
          throw new Error(registrationResult.error || 'Account creation failed');
        }
        
        console.log("User account created successfully:", registrationResult.user.uid);
        
        // Update the user state
        setUser(registrationResult.user);
        
        // Create a free order for the new user
        const orderResult = await processPayment(
          null, // No payment details for free purchase
          registrationResult.user.uid,
          {
            amount: 0,
            plan: selectedPlan,
            productName: selectedProduct?.name || getPlanDisplayName(),
            productId: selectedProduct?.id || selectedPlan,
            discount: discount,
            couponCode: couponCode,
            isFree: true,
            productMetadata: selectedProduct ? {
              category: selectedProduct.category,
              type: selectedProduct.type,
              features: selectedProduct.features,
              fileUrl: selectedProduct.fileUrl,
              fileName: selectedProduct.fileName
            } : null
          }
        );
        
        if (!orderResult.success) {
          throw new Error(orderResult.error || 'Error processing your free access');
        }
        
        console.log("Free order created:", orderResult.orderId);
        
        // Set order ID and move to confirmation
        setOrderId(orderResult.orderId);
        changeCheckoutStep('confirmation');
        
        // Set payment verification in session storage for immediate access
        sessionStorage.setItem('paymentVerified', 'true');
        
        return;
      }
      
      // Handle case for already logged-in user
      if (user && user.uid) {
        console.log("Processing free purchase for existing user:", user.uid);
        
        // Create a free order record
        const result = await processPayment(
          null, // No payment details needed for free purchase
          user.uid,
          {
            amount: 0,
            plan: selectedPlan,
            productName: selectedProduct?.name || getPlanDisplayName(),
            productId: selectedProduct?.id || selectedPlan,
            discount: discount,
            couponCode: couponCode,
            isFree: true,
            productMetadata: selectedProduct ? {
              category: selectedProduct.category,
              type: selectedProduct.type,
              features: selectedProduct.features,
              fileUrl: selectedProduct.fileUrl,
              fileName: selectedProduct.fileName
            } : null
          }
        );
        
        if (!result.success) {
          throw new Error(result.error || 'Error processing your free access');
        }
        
        console.log("Free order created:", result.orderId);
        
        // Set order ID and move to confirmation
        setOrderId(result.orderId);
        changeCheckoutStep('confirmation');
        
        // Set payment verification in session storage for immediate access
        sessionStorage.setItem('paymentVerified', 'true');
      } else {
        throw new Error('User account required to complete purchase');
      }
    } catch (error) {
      console.error("Free purchase error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Handle authentication success
  const handleAuthSuccess = (userData) => {
    console.log("Auth success in checkout flow:", userData);
    
    // If this is actual authentication (user already exists)
    if (userData?.user) {
      setUser(userData.user); // Set the user state for navbar
      setShowAuthModal(false);
      changeCheckoutStep('payment');
      return;
    }
    
    // If this is data collection for new user registration
    if (userData && userData.email) {
      setPendingUserData({
        email: userData.email,
        password: userData.password || '',
        firstName: userData.firstName || '',
        lastName: userData.lastName || ''
      });
      
      setShowAuthModal(false);
      changeCheckoutStep('payment');
      return;
    }
    
    if (userData?.isGuest) {
      navigate('/guest-preview');
    }
  };

  // Handle continue to review
  const continueToReview = (e) => {
    e.preventDefault();
    
    // Validate card details
    let isValid = true;
    let errorMessage = '';
    
    const cardNumber = cardInfo.number.replace(/\s/g, '');
    if (!cardNumber || cardNumber.length < 15 || cardNumber.length > 16) {
      isValid = false;
      errorMessage = 'Please enter a valid card number';
    }
    
    if (!cardInfo.expiry || !cardInfo.expiry.includes('/')) {
      isValid = false;
      errorMessage = 'Please enter a valid expiration date (MM/YY)';
    }
    
    if (!cardInfo.cvc || cardInfo.cvc.length < 3) {
      isValid = false;
      errorMessage = 'Please enter a valid CVC code';
    }
    
    if (!cardInfo.name || cardInfo.name.trim().length < 3) {
      isValid = false;
      errorMessage = 'Please enter the cardholder name';
    }
    
    if (!isValid) {
      setError(errorMessage);
      return;
    }
    
    // Clear any previous errors
    setError('');
    
    // Move to review step
    changeCheckoutStep('review');
  };

  // Detect card type based on first digits
  const detectCardType = (cardNumber) => {
    const cleanNumber = cardNumber.replace(/\s+/g, '');
    
    // Visa - starts with 4
    if (/^4/.test(cleanNumber)) return 'visa';
    
    // Mastercard - starts with 51-55, or 2221-2720
    if (/^5[1-5]/.test(cleanNumber) || /^2[2-7][0-9]{2}/.test(cleanNumber)) return 'mastercard';
    
    // American Express - starts with 34 or 37
    if (/^3[47]/.test(cleanNumber)) return 'amex';
    
    return null;
  };

  // Handle card input changes with better formatting
  const handleCardInputChange = (e) => {
    const { name, value } = e.target;
    
    // Format card number with spaces
    if (name === 'number') {
      // Remove all non-digits and existing spaces
      let digits = value.replace(/\D/g, '');
      let formattedValue = '';
      
      // Detect card type
      const cardType = detectCardType(digits);
      
      // Format differently based on card type
      if (cardType === 'amex') {
        // Format as 4-6-5 for American Express
        for (let i = 0; i < digits.length && i < 15; i++) {
          if (i === 4 || i === 10) formattedValue += ' ';
          formattedValue += digits[i];
        }
      } else {
        // Format as 4-4-4-4 for other cards
        for (let i = 0; i < digits.length && i < 16; i++) {
          if (i > 0 && i % 4 === 0) formattedValue += ' ';
          formattedValue += digits[i];
        }
      }
      
      setCardInfo({
        ...cardInfo,
        [name]: formattedValue,
        cardType
      });
    } 
    // Format expiry date as MM/YY
    else if (name === 'expiry') {
      let digits = value.replace(/\D/g, '');
      let formattedValue = '';
      
      // Format first 2 digits as month
      if (digits.length > 0) {
        // Make sure month is valid (01-12)
        let month = digits.substring(0, 2);
        if (month.length === 1) {
          if (parseInt(month) > 1) {
            month = '0' + month;
          }
        } else if (parseInt(month) > 12) {
          month = '12';
        } else if (parseInt(month) === 0) {
          month = '01';
        }
        
        formattedValue = month;
        
        // Add slash and year if we have enough digits
        if (digits.length > 2) {
          formattedValue += '/' + digits.substring(2, 4);
        }
      }
      
      setCardInfo({
        ...cardInfo,
        [name]: formattedValue
      });
    }
    // Restrict CVC to numbers only and limit length based on card type
    else if (name === 'cvc') {
      const digits = value.replace(/\D/g, '');
      const maxLength = cardInfo.cardType === 'amex' ? 4 : 3;
      
      setCardInfo({
        ...cardInfo,
        [name]: digits.substring(0, maxLength)
      });
    }
    // All other fields
    else {
      setCardInfo({
        ...cardInfo,
        [name]: value
      });
    }
  };

  // Render card brand icon based on detected card type
  const renderCardBrandIcon = () => {
    if (!cardInfo.cardType) {
      return (
        <div className="card-icons">
          <img src={require('../../assets/images/card-visa.png')} alt="Visa" className="card-icon visa-faded" style={{opacity: 0.3}} />
          <img src={require('../../assets/images/card-mastercard.png')} alt="Mastercard" className="card-icon mastercard-faded" style={{opacity: 0.3}} />
          <img src={require('../../assets/images/card-amex.png')} alt="Amex" className="card-icon amex-faded" style={{opacity: 0.3}} />
        </div>
      );
    }
    
    switch(cardInfo.cardType) {
      case 'visa':
        return <img src={require('../../assets/images/card-visa.png')} alt="Visa" className="card-icon visa" />;
      case 'mastercard':
        return <img src={require('../../assets/images/card-mastercard.png')} alt="Mastercard" className="card-icon mastercard" />;
      case 'amex':
        return <img src={require('../../assets/images/card-amex.png')} alt="Amex" className="card-icon amex" />;
      default:
        return <img src={require('../../assets/images/card-visa.png')} alt="Card" className="card-icon" style={{opacity: 0.3}} />;
    }
  };

  // Handle registration data collection but don't create account yet
  const handleAuthDataCollection = (userData) => {
    console.log("Registration data collected:", userData);
    
    // Store pending user data
    setPendingUserData({
      email: userData.email,
      password: userData.password,
      firstName: userData.firstName || '',
      lastName: userData.lastName || ''
    });
    
    // Mark registration step as complete
    setRegistrationComplete(true);
    
    // Close auth modal
    setShowAuthModal(false);
    
    // Move to payment step without creating Firebase account
    changeCheckoutStep('payment');
  };

  // Calculate subscription end date based on plan type
  const getSubscriptionEndDate = () => {
    const now = new Date();
    if (subscription.type === 'monthly') {
      return new Date(now.setMonth(now.getMonth() + 1)).toISOString();
    } else if (subscription.type === 'yearly') {
      return new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
    } else {
      // For one-time purchases, set to 1 year by default
      return new Date(now.setFullYear(now.getFullYear() + 1)).toISOString();
    }
  };

  // Updated handleProcessPayment function with product integration
  const handleProcessPayment = async () => {
    setLoading(true);
    setError('');

    try {
      console.log("Starting payment processing...");
      
      if (!stripeWrapperRef || !stripeWrapperRef.current) {
        console.error("Stripe wrapper ref is not available");
        throw new Error("Payment system not initialized. Please refresh and try again.");
      }

      const finalPrice = parseFloat(getFinalPrice());
      console.log(`Processing payment of $${finalPrice} for plan: ${selectedPlan}`);

      // Create payment method with Stripe
      console.log("Creating payment method with Stripe...");
      const paymentResult = await stripeWrapperRef.current.submitPayment();
      console.log("Payment result:", paymentResult);
      
if (!paymentResult || !paymentResult.success || !paymentResult.paymentMethod) {
       console.error("Failed to create payment method", paymentResult);
       throw new Error(paymentResult?.error || "Failed to create payment method. Please check your card details and try again.");
     }
     
     const paymentMethod = paymentResult.paymentMethod;
     console.log("Payment method created:", paymentMethod.id);

     // Create user account if needed (for new users)
     let currentUserId = user?.uid;
     if (!user && pendingUserData) {
       console.log("Creating user account...");
       const registrationResult = await registerUser(
         pendingUserData.email,
         pendingUserData.password,
         pendingUserData.firstName,
         pendingUserData.lastName
       );

       if (!registrationResult.user) {
         console.error("Account creation failed");
         throw new Error("Failed to create your account. Please try again.");
       }

       setUser(registrationResult.user);
       currentUserId = registrationResult.user.uid;
     }

     // Process payment through our service with product metadata
     const orderResult = await processPayment(
       {
         paymentMethodId: paymentMethod.id,
         card: {
           brand: paymentMethod.card.brand,
           last4: paymentMethod.card.last4,
           expMonth: paymentMethod.card.exp_month,
           expYear: paymentMethod.card.exp_year
         },
         billingDetails: paymentMethod.billing_details
       },
       currentUserId,
       {
         amount: finalPrice,
         plan: selectedPlan,
         productName: selectedProduct?.name || getPlanDisplayName(),
         productId: selectedProduct?.id || selectedPlan,
         discount: discount,
         couponCode: couponCode,
         productMetadata: selectedProduct ? {
           category: selectedProduct.category,
           type: selectedProduct.type,
           features: selectedProduct.features,
           fileUrl: selectedProduct.fileUrl,
           fileName: selectedProduct.fileName
         } : null
       }
     );

     if (!orderResult.success) {
       throw new Error(orderResult.error || "Failed to process your order");
     }

     console.log("Order created successfully:", orderResult.orderId);

     // Save payment method if requested
     if (savePaymentMethod && currentUserId) {
       const savedPaymentMethod = {
         id: uuidv4(),
         cardholderName: paymentMethod.billing_details.name || 'Unknown',
         lastFourDigits: paymentMethod.card.last4,
         expiryDate: `${paymentMethod.card.exp_month}/${paymentMethod.card.exp_year.toString().substr(-2)}`,
         cardType: paymentMethod.card.brand,
         isDefault: true,
         createdAt: new Date().toISOString()
       };
       
       try {
         await userService.savePaymentMethod(currentUserId, savedPaymentMethod);
       } catch (saveError) {
         console.warn("Failed to save payment method:", saveError);
       }
     }

     // Save billing address if requested
     if (saveAddress && billingAddress.name && currentUserId) {
       const address = {
         id: uuidv4(),
         name: billingAddress.name,
         line1: billingAddress.line1,
         line2: billingAddress.line2 || '',
         city: billingAddress.city,
         state: billingAddress.state,
         postalCode: billingAddress.postalCode,
         country: billingAddress.country,
         isDefault: true,
         createdAt: new Date().toISOString()
       };
       
       try {
         await userService.saveAddress(currentUserId, address);
       } catch (saveError) {
         console.warn("Failed to save address:", saveError);
       }
     }

     // Set payment verification and move to confirmation
     sessionStorage.setItem('paymentVerified', 'true');
     setOrderId(orderResult.orderId);
     changeCheckoutStep('confirmation');

   } catch (error) {
     console.error("Payment/Registration error:", error);
     setError(error.message || "An error occurred during payment processing. Please try again.");
   } finally {
     setLoading(false);
   }
 };

 // Get plan display name with product support
 const getPlanDisplayName = () => {
   if (selectedProduct) {
     return selectedProduct.name;
   }
   
   // Fallback for legacy plan IDs
   switch(selectedPlan) {
     case 'cheatsheet':
       return 'The Cheatsheet';
     case 'cheatsheet-plus':
       return 'The Cheatsheet+';
     case 'application':
       return 'Application Cheatsheet';
     case 'application-plus':
       return 'Application Cheatsheet+';
     default:
       return 'Selected Plan';
   }
 };

 // Get text for subscription period
 const getSubscriptionPeriodText = () => {
   if (subscription.type === 'monthly') {
     return 'every month';
   } else if (subscription.type === 'yearly') {
     return 'per year';
   } else {
     return 'one time';
   }
 };

 // Render different steps based on checkout progress
 const renderCheckoutStep = () => {
   switch (checkoutStep) {
     case 'plan':
       return renderPlanSelection();
     case 'payment':
       return renderPaymentForm();
     case 'review':
       return renderReviewStep();
     case 'confirmation':
       return renderConfirmation();
     default:
       return renderPlanSelection();
   }
 };

 // Render plan selection step
 const renderPlanSelection = () => {
   // Check URL params for upgrade and plan selection
   const urlParams = new URLSearchParams(location.search);
   const preSelectedPlan = urlParams.get('plan');
   const isUpgrade = urlParams.get('upgrade') === 'true';
   
   // If this is an upgrade for an authenticated user, skip plan selection
   if (user && isUpgrade && preSelectedPlan) {
     setSelectedPlan(preSelectedPlan);
     setCheckoutStep('payment');
     return renderPaymentForm();
   }
   
   // If plan is pre-selected and user is authenticated, go to payment
   if (user && preSelectedPlan) {
     setSelectedPlan(preSelectedPlan);
     setCheckoutStep('payment');
     return renderPaymentForm();
   }
   
   // If plan is pre-selected but no user, show auth modal
   if (preSelectedPlan && !user && !showAuthModal) {
     setSelectedPlan(preSelectedPlan);
     setShowAuthModal(true);
   }
   
   // Show loading while products are being fetched
   if (productsLoading) {
     return (
       <div className="checkout-header">
         <h1>Loading products...</h1>
         <div className="loader-container">
           <div className="loader"></div>
         </div>
       </div>
     );
   }
   
   return (
     <>
       <div className="checkout-header">
         <h1>This is your in.</h1>
         <p>The full profiles of successful medical school applicants will be available once you join the cheatsheet.</p>
       </div>
       
       <PricingCards onSelectPlan={handleProceedToPayment} />
     </>
   );
 };

 // This function collects user registration data without creating the account
 const handleRegistrationDataCollection = (userData) => {
   console.log("Registration data collected:", userData);
   
   // Store pending user data for later account creation
   setPendingUserData({
     email: userData.email,
     password: userData.password,
     firstName: userData.firstName || '',
     lastName: userData.lastName || ''
   });
   
   // Mark registration as complete
   setRegistrationComplete(true);
   
   // Close the auth modal
   setShowAuthModal(false);
 };

 // Add this explicit handler for confirming free purchases
 const handleConfirmFreePurchase = async () => {
   console.log("Confirming free purchase");
   setLoading(true);
   setError('');
   
   try {
     // We need to check if we have pending user data (new user) or existing user
     if (!user && pendingUserData) {
       console.log("Creating account from pending data:", pendingUserData.email);
       
       // 1. First create the user account
       const registrationResult = await registerUser(
         pendingUserData.email,
         pendingUserData.password,
         pendingUserData.firstName,
         pendingUserData.lastName
       );
       
       if (!registrationResult.user || !registrationResult.success) {
         console.error("Failed to create user account:", registrationResult.error);
         throw new Error(registrationResult.error || 'Failed to create your account');
       }
       
       console.log("Account created successfully:", registrationResult.user.uid);
       
       // 2. Set the user state with the newly created user
       setUser(registrationResult.user);
       
       // 3. Create a free order for this user (processPayment handles everything)
       const orderResult = await processPayment(
         null, // No payment details for free purchase
         registrationResult.user.uid,
         {
           amount: 0,
           plan: selectedPlan,
           productName: selectedProduct?.name || getPlanDisplayName(),
           productId: selectedProduct?.id || selectedPlan,
           discount: discount,
           couponCode: couponCode,
           isFree: true,
           productMetadata: selectedProduct ? {
             category: selectedProduct.category,
             type: selectedProduct.type,
             features: selectedProduct.features,
             fileUrl: selectedProduct.fileUrl,
             fileName: selectedProduct.fileName
           } : null
         }
       );
       
       if (!orderResult.success) {
         console.error("Failed to create order:", orderResult.error);
         throw new Error(orderResult.error || 'Failed to process your free access');
       }
       
       console.log("Order created successfully:", orderResult.orderId);
       
       // 4. Save payment method if the user opted to (even for free purchases)
       if (savePaymentMethod) {
         const paymentMethod = {
           id: uuidv4(),
           cardholderName: "Free Purchase",
           lastFourDigits: "0000",
           expiryDate: "N/A",
           cardType: "Coupon",
           isDefault: true,
           createdAt: new Date().toISOString()
         };
         
         await userService.savePaymentMethod(registrationResult.user.uid, paymentMethod);
       }

       // 5. Save billing address if the user opted to
       if (saveAddress && billingAddress.name) {
         const address = {
           id: uuidv4(),
           name: billingAddress.name,
           line1: billingAddress.line1,
           line2: billingAddress.line2 || '',
           city: billingAddress.city,
           state: billingAddress.state,
           postalCode: billingAddress.postalCode,
           country: billingAddress.country,
           isDefault: true,
           createdAt: new Date().toISOString()
         };
         
         await userService.saveAddress(registrationResult.user.uid, address);
       }
       
       // 6. Set payment verification in session storage for immediate access
       sessionStorage.setItem('paymentVerified', 'true');
       
       // 7. Move to confirmation step
       setOrderId(orderResult.orderId);
       changeCheckoutStep('confirmation');
       
     } else if (user && user.uid) {
       // Handle existing user free purchase
       console.log("Processing free purchase for existing user:", user.uid);
       
       const result = await processPayment(
         null, // No payment details needed for free purchase
         user.uid,
         {
           amount: 0,
           plan: selectedPlan,
           productName: selectedProduct?.name || getPlanDisplayName(),
           productId: selectedProduct?.id || selectedPlan,
           discount: discount,
           couponCode: couponCode,
           isFree: true,
           productMetadata: selectedProduct ? {
             category: selectedProduct.category,
             type: selectedProduct.type,
             features: selectedProduct.features,
             fileUrl: selectedProduct.fileUrl,
             fileName: selectedProduct.fileName
           } : null
         }
       );
       
       if (!result.success) {
         throw new Error(result.error || 'Error processing your free access');
       }
       
       console.log("Free order created:", result.orderId);

       // Save payment method and address for existing users too
       if (savePaymentMethod) {
         const paymentMethod = {
           id: uuidv4(),
           cardholderName: "Free Purchase",
           lastFourDigits: "0000",
           expiryDate: "N/A",
           cardType: "Coupon",
           isDefault: true,
           createdAt: new Date().toISOString()
         };
         
         await userService.savePaymentMethod(user.uid, paymentMethod);
       }

       if (saveAddress && billingAddress.name) {
         const address = {
           id: uuidv4(),
           name: billingAddress.name,
           line1: billingAddress.line1,
           line2: billingAddress.line2 || '',
           city: billingAddress.city,
           state: billingAddress.state,
           postalCode: billingAddress.postalCode,
           country: billingAddress.country,
           isDefault: true,
           createdAt: new Date().toISOString()
         };
         
         await userService.saveAddress(user.uid, address);
       }
       
       // Set order ID and move to confirmation
       setOrderId(result.orderId);
       changeCheckoutStep('confirmation');
       
       // Set payment verification in session storage for immediate access
       sessionStorage.setItem('paymentVerified', 'true');
     } else {
       throw new Error('Missing user information. Please try again.');
     }
   } catch (error) {
     console.error("Free purchase error:", error);
     setError(error.message || 'An error occurred while processing your order');
   } finally {
     setLoading(false);
   }
 };

 // Render payment form step
 const renderPaymentForm = () => {
   // If we need to collect user data first and haven't done so yet
   if (!user && !pendingUserData && !loading) {
     return (
       <div className="payment-form-container">
         <div className="payment-header">
           <h2>Creating Your Account</h2>
           <p>Please provide your details to continue with payment</p>
         </div>
         
         {/* Back button to plan selection */}
         <div className="navigation-controls">
           <button className="back-button" onClick={handleGoBack}>
             ← Back to Plans
           </button>
         </div>
         
         <div className="loader-container">
           <div className="loader"></div>
         </div>
       </div>
     );
   }
   
   // If purchase is free with 100% discount, show confirmation screen instead of auto-processing
   if (isFreeWithCoupon()) {
     return (
       <div className="payment-form-container">
         <div className="payment-header">
           <h2>Confirm Free Access</h2>
           <p>Your order qualifies for free access with the applied coupon.</p>
         </div>
         
         {/* Back button */}
         <div className="navigation-controls">
           <button className="back-button" onClick={handleGoBack}>
             ← Back
           </button>
         </div>
         
         <div className="order-summary">
           <h3>Order Summary</h3>
           <div className="order-details">
             <div className="plan-name">
               <h4>{getPlanDisplayName()}</h4>
               <p className="subscription-period">
                 <span style={{textDecoration: 'line-through'}}>${getBasePrice().toFixed(2)}</span>
                 {' '}<strong>FREE</strong> {getSubscriptionPeriodText()}
               </p>
               {selectedProduct?.description && (
                 <p className="plan-description">{selectedProduct.description}</p>
               )}
             </div>
             
             <div className="applied-discount">
               <div className="discount-info" style={{marginBottom: '20px'}}>
                 <span>Discount coupon applied: </span>
                 <span><strong>{couponCode}</strong> ({discount}% off)</span>
               </div>
             </div>
             
             {/* If we have pending user data, show account details to be created */}
             {pendingUserData && (
               <div className="user-info-summary" style={{
                 backgroundColor: 'rgba(16, 185, 129, 0.1)',
                 borderLeft: '3px solid #10b981',
                 padding: '15px',
                 marginBottom: '20px',
                 borderRadius: '4px'
               }}>
                 <h4 style={{marginBottom: '10px'}}>Account Details</h4>
                 <p><strong>Email:</strong> {pendingUserData.email}</p>
                 <p><strong>Name:</strong> {pendingUserData.firstName} {pendingUserData.lastName}</p>
                 <p style={{marginTop: '10px', fontSize: '0.9em', fontStyle: 'italic'}}>
                   Your account will be created when you confirm your order.
                 </p>
               </div>
             )}

             {/* Save Payment Method Option (even for free purchases) */}
             <div className="form-group checkbox" style={{marginTop: '20px'}}>
               <input
                 type="checkbox"
                 id="savePaymentMethod"
                 checked={savePaymentMethod}
                 onChange={(e) => setSavePaymentMethod(e.target.checked)}
                 disabled={loading}
               />
               <label htmlFor="savePaymentMethod">
                 Save payment method for future purchases
               </label>
             </div>

             {/* Billing Address Fields */}
             {savePaymentMethod && (
               <div className="billing-address-section" style={{marginTop: '20px', marginBottom: '20px'}}>
                 <h3>
                   <img src={require('../../assets/images/location.png')} alt="Location" className="form-icon" />
                   Billing Address
                 </h3>
                 
                 <div className="form-group">
                   <label htmlFor="billingName">Full Name</label>
                   <input
                     type="text"
                     id="billingName"
                     name="name"
                     value={billingAddress.name}
                     onChange={handleAddressChange}
                     placeholder="Full Name"
                   />
                 </div>
                 
                 <div className="form-group">
                   <label htmlFor="billingLine1">Address Line 1</label>
                   <input
                     type="text"
                     id="billingLine1"
                     name="line1"
                     value={billingAddress.line1}
                     onChange={handleAddressChange}
                     placeholder="Street address, P.O. box"
                   />
                 </div>
                 
                 <div className="form-group">
                   <label htmlFor="billingLine2">Address Line 2 (Optional)</label>
                   <input
                     type="text"
                     id="billingLine2"
                     name="line2"
                     value={billingAddress.line2}
                     onChange={handleAddressChange}
                     placeholder="Apartment, suite, unit, building, etc."
                   />
                 </div>
                 
                 <div className="form-row">
                   <div className="form-group">
                     <label htmlFor="billingCity">City</label>
                     <input
                       type="text"
                       id="billingCity"
                       name="city"
                       value={billingAddress.city}
                       onChange={handleAddressChange}
                       placeholder="City"
                     />
                   </div>
                   
                   <div className="form-group">
                     <label htmlFor="billingState">State</label>
                     <input
                       type="text"
                       id="billingState"
                       name="state"
                       value={billingAddress.state}
                       onChange={handleAddressChange}
                       placeholder="State"
                     />
                   </div>
                 </div>
                 
                 <div className="form-row">
                   <div className="form-group">
                     <label htmlFor="billingPostalCode">Postal Code</label>
                     <input
                       type="text"
                       id="billingPostalCode"
                       name="postalCode"
                       value={billingAddress.postalCode}
                       onChange={handleAddressChange}
                       placeholder="Postal Code"
                     />
                   </div>
                   
                   <div className="form-group">
                     <label htmlFor="billingCountry">Country</label>
                     <select
                       id="billingCountry"
                       name="country"
                       value={billingAddress.country}
                       onChange={handleAddressChange}
                     >
                       {countries.map(country => (
                         <option key={country.code} value={country.name}>
                           {country.name}
                         </option>
                       ))}
                     </select>
                   </div>
                 </div>
                 
                 <div className="form-group checkbox">
                   <input
                     type="checkbox"
                     id="saveAddress"
                     checked={saveAddress}
                     onChange={(e) => setSaveAddress(e.target.checked)}
                     disabled={loading}
                   />
                   <label htmlFor="saveAddress">
                     Save address for future purchases
                   </label>
                 </div>
               </div>
             )}
             
             {/* Show a prominent confirm button */}
             <button 
               onClick={handleConfirmFreePurchase} 
               style={{
                 width: '100%',
                 padding: '15px',
                 backgroundColor: '#065f46',
                 color: 'white',
                 border: 'none',
                 borderRadius: '8px',
                 fontSize: '1.1rem',
                 fontWeight: 'bold',
                 cursor: 'pointer',
                 marginTop: '20px',
                 marginBottom: '20px'
               }}
               disabled={loading}
             >
               {loading ? 'Processing...' : 'Confirm Free Access'}
             </button>
             
             {/* Show any error messages */}
             {error && (
               <div style={{
                 color: '#e53e3e',
                 backgroundColor: '#fee2e2',
                 padding: '10px 15px',
                 borderRadius: '4px',
                 marginTop: '15px'
               }}>
                 {error}
               </div>
             )}
           </div>
         </div>
       </div>
     );
   }
   
   // Regular payment form for non-free purchases
   return (
     <div className="payment-form-container">
       <div className="payment-header">
         <h2>Payment & Discounts</h2>
         <p>Transactions are secure and encrypted.</p>
       </div>
       
       <div className="order-summary">
         <h3>Subscription Summary</h3>
         <div className="order-details">
           <div className="plan-name">
             <h4>{getPlanDisplayName()}</h4>
             <p className="subscription-period">${getBasePrice().toFixed(2)} {getSubscriptionPeriodText()}</p>
             {selectedProduct?.description && (
               <p className="plan-description">{selectedProduct.description}</p>
             )}
           </div>
           
           {/* GIFT OR DISCOUNT CODE SECTION */}
           <div className="discount-section">
             <h4>GIFT OR DISCOUNT CODE</h4>
             
             {!couponApplied ? (
               <div className="coupon-input-group">
                 <input
                   type="text"
                   placeholder="Gift or Discount Code"
                   value={couponCode}
                   onChange={(e) => setCouponCode(e.target.value)}
                   className="coupon-input"
                 />
                 <button 
                   className="apply-coupon-btn"
                   onClick={applyCoupon}
                 >
                   APPLY
                 </button>
               </div>
             ) : (
               <div className="applied-discount">
                 <div className="discount-info">
                   <span>Discount ({discount}% off)</span>
                   <span>-${getDiscountAmount().toFixed(2)}</span>
                 </div>
                 <button className="remove-discount-btn" onClick={removeCoupon}>
                   Remove
                 </button>
               </div>
             )}
           </div>
           
           <div className="checkout-summary">
             <div className="summary-row">
               <span>Subtotal</span>
               <span>${getBasePrice().toFixed(2)}</span>
             </div>
             
             {couponApplied && (
               <div className="summary-row discount">
                 <span>Discount ({discount}%)</span>
                 <span>-${getDiscountAmount().toFixed(2)}</span>
               </div>
             )}
             
             <div className="summary-row">
               <span>Tax</span>
               <span>$0.00</span>
             </div>
             
             <div className="summary-row total">
               <span>Total</span>
               <span>${getFinalPrice()}</span>
             </div>
           </div>
         </div>
       </div>
       
       <div className="payment-form">
         <h3>
           <img src={require('../../assets/images/credit-card.png')} alt="Card" className="form-icon" />
           Card Information
         </h3>
           
         {error && <div className="payment-error">{error}</div>}
         
         {/* If we have pending user data (from auth modal), show their email */}
         {pendingUserData && (
           <div className="user-info-summary">
             <p>Account will be created for: <strong>{pendingUserData.email}</strong></p>
             <p className="pending-note">Your account will be created after successful payment.</p>
           </div>
         )}
         
         {/* Card details first */}
         <div className="card-info-section">
           <StripeWrapper
             ref={stripeWrapperRef}
             onSuccess={(paymentMethod) => {
               console.log("Payment method created:", paymentMethod);
             }}
             onError={(errorMessage) => {
               setError(errorMessage);
             }}
             processingPayment={loading}
           />
         </div>
         
         {/* Save Payment Method Option - MOVED ABOVE BILLING ADDRESS */}
         <div className="form-group checkbox" style={{marginTop: '20px'}}>
           <input
             type="checkbox"
             id="savePaymentMethod"
             checked={savePaymentMethod}
             onChange={(e) => setSavePaymentMethod(e.target.checked)}
             disabled={loading}
           />
           <label htmlFor="savePaymentMethod">
             Save payment method for future purchases
           </label>
         </div>

         {/* Billing Address Fields ONLY shows if savePaymentMethod is checked */}
         {savePaymentMethod && (
           <div className="billing-address-section" style={{marginTop: '20px', marginBottom: '20px'}}>
             <h3>
               <img src={require('../../assets/images/location.png')} alt="Location" className="form-icon" />
               Billing Address
             </h3>
             
             <div className="form-group">
               <label htmlFor="billingName">Full Name</label>
               <input
                 type="text"
                 id="billingName"
                 name="name"
                 value={billingAddress.name}
                 onChange={handleAddressChange}
                 placeholder="Full Name"
               />
             </div>
             
             <div className="form-group">
               <label htmlFor="billingLine1">Address Line 1</label>
               <input
                 type="text"
                 id="billingLine1"
                 name="line1"
                 value={billingAddress.line1}
                 onChange={handleAddressChange}
                 placeholder="Street address, P.O. box"
               />
             </div>
             
             <div className="form-group">
               <label htmlFor="billingLine2">Address Line 2 (Optional)</label>
               <input
                 type="text"
                 id="billingLine2"
                 name="line2"
                 value={billingAddress.line2}
                 onChange={handleAddressChange}
                 placeholder="Apartment, suite, unit, building, etc."
               />
             </div>
             
             <div className="form-row">
               <div className="form-group">
                 <label htmlFor="billingCity">City</label>
                 <input
                   type="text"
                   id="billingCity"
                   name="city"
                   value={billingAddress.city}
                   onChange={handleAddressChange}
                   placeholder="City"
                 />
               </div>
               
               <div className="form-group">
                 <label htmlFor="billingState">State</label>
                 <input
                   type="text"
                   id="billingState"
                   name="state"
                   value={billingAddress.state}
                   onChange={handleAddressChange}
                   placeholder="State"
                 />
               </div>
             </div>
             
             <div className="form-row">
               <div className="form-group">
                 <label htmlFor="billingPostalCode">Postal Code</label>
                 <input
                   type="text"
                   id="billingPostalCode"
                   name="postalCode"
                   value={billingAddress.postalCode}
                   onChange={handleAddressChange}
                   placeholder="Postal Code"
                 />
               </div>
               
               <div className="form-group">
                 <label htmlFor="billingCountry">Country</label>
                 <select
                   id="billingCountry"
                   name="country"
                   value={billingAddress.country}
                   onChange={handleAddressChange}
                 >
                   {countries.map(country => (
                     <option key={country.code} value={country.name}>
                       {country.name}
                     </option>
                   ))}
                 </select>
               </div>
             </div>
             
             <div className="form-group checkbox">
               <input
                 type="checkbox"
                 id="saveAddress"
                 checked={saveAddress}
                 onChange={(e) => setSaveAddress(e.target.checked)}
                 disabled={loading}
               />
               <label htmlFor="saveAddress">
                 Save address for future purchases
               </label>
             </div>
           </div>
         )}
         
         {/* Payment button ALWAYS AFTER EVERYTHING */}
         <button 
           type="button"
           className="payment-button" 
           onClick={handleProcessPayment}
           disabled={loading}
           style={{
             width: '100%',
             backgroundColor: '#1A3A34',
             color: 'white',
             border: 'none',
             borderRadius: '8px',
             padding: '16px',
             fontSize: '1rem',
             fontWeight: '600',
             cursor: 'pointer',
             marginTop: '24px',
             marginBottom: '16px'
           }}
         >
           {loading ? 'Processing...' : 'PAY NOW'}
         </button>
         
         <div className="secure-checkout">
         <div className="secure-icon">🔒</div>
           <span>SECURE SSL CHECKOUT</span>
         </div>
       </div>
     </div>
   );
 };

 // Render review step
 const renderReviewStep = () => {
   return (
     <div className="review-container">
       <div className="review-header">
         <h2>Review & Subscribe</h2>
         <p>Please review your subscription details before finalizing your purchase</p>
       </div>
       
       {/* Back button */}
       <div className="navigation-controls">
         <button className="back-button" onClick={handleGoBack}>
           ← Back
         </button>
       </div>
       
       <div className="subscription-summary">
         <h3>Subscription Summary</h3>
         
         <div className="summary-details">
           <h4>{getPlanDisplayName()}</h4>
           <p className="subscription-period">${getBasePrice().toFixed(2)} {getSubscriptionPeriodText()}</p>
           {selectedProduct?.description && (
             <p className="plan-description">{selectedProduct.description}</p>
           )}
           
           {/* GIFT OR DISCOUNT CODE SECTION */}
           <div className="discount-section">
             <h4>GIFT OR DISCOUNT CODE</h4>
             
             {!couponApplied ? (
               <div className="coupon-input-group">
                 <input
                   type="text"
                   placeholder="Gift or Discount Code"
                   value={couponCode}
                   onChange={(e) => setCouponCode(e.target.value)}
                   className="coupon-input"
                 />
                 <button 
                   className="apply-coupon-btn"
                   onClick={applyCoupon}
                 >
                   APPLY
                 </button>
               </div>
             ) : (
               <div className="applied-discount">
                 <div className="discount-info">
                   <span>Discount ({discount}% off)</span>
                   <span>-${getDiscountAmount().toFixed(2)}</span>
                 </div>
                 <button className="remove-discount-btn" onClick={removeCoupon}>
                   Remove
                 </button>
               </div>
             )}
           </div>
           
           <div className="payment-method">
             <h4>Payment Method</h4>
             <div className="card-info">
               <div className="card-icon">
                 {cardInfo.brand === 'visa' && (
                   <img src={require('../../assets/images/card-visa.png')} alt="Visa" className="card-icon" />
                 )}
                 {cardInfo.brand === 'mastercard' && (
                   <img src={require('../../assets/images/card-mastercard.png')} alt="Mastercard" className="card-icon" />
                 )}
                 {cardInfo.brand === 'amex' && (
                   <img src={require('../../assets/images/card-amex.png')} alt="Amex" className="card-icon" />
                 )}
                 {(!cardInfo.brand || !['visa', 'mastercard', 'amex'].includes(cardInfo.brand)) && (
                   <img src={require('../../assets/images/card-visa.png')} alt="Card" className="card-icon" style={{opacity: 0.3}} />
                 )}
               </div>
               <div className="card-details">
                 <p>**** **** **** {cardInfo.last4 || '****'}</p>
                 <p>{cardInfo.name || 'Cardholder'}</p>
               </div>
             </div>
           </div>
           
           {/* Display billing address if provided */}
           {savePaymentMethod && billingAddress.name && (
             <div className="billing-address">
               <h4>Billing Address</h4>
               <div className="address-info">
                 <p>{billingAddress.name}</p>
                 <p>{billingAddress.line1}</p>
                 {billingAddress.line2 && <p>{billingAddress.line2}</p>}
                 <p>{billingAddress.city}, {billingAddress.state} {billingAddress.postalCode}</p>
                 <p>{billingAddress.country}</p>
               </div>
               
               <div className="save-preferences">
                 <p style={{fontSize: '0.9rem', color: '#065f46', fontWeight: '500', marginTop: '10px'}}>
                   {savePaymentMethod && saveAddress 
                     ? "Your payment method and address will be saved for future purchases."
                     : savePaymentMethod 
                       ? "Your payment method will be saved for future purchases."
                       : ""}
                 </p>
               </div>
             </div>
           )}
           
           <div className="checkout-summary">
             <div className="summary-row">
               <span>Subtotal</span>
               <span>${getBasePrice().toFixed(2)}</span>
             </div>
             
             {couponApplied && (
               <div className="summary-row discount">
                 <span>Discount ({discount}%)</span>
                 <span>-${getDiscountAmount().toFixed(2)}</span>
               </div>
             )}
             
             <div className="summary-row">
               <span>Tax</span>
               <span>$0.00</span>
             </div>
             
             <div className="summary-row total">
               <span>Total</span>
               <span>${getFinalPrice()}</span>
             </div>
           </div>
         </div>
       </div>
       
       <div className="terms-section">
         <p>
           By clicking "Subscribe" below, you agree to our Terms of Service and authorize us to charge your card for the amount shown above.
           You can cancel at any time from your account settings.
         </p>
       </div>
       
       <button 
         className="subscribe-button" 
         onClick={handleProcessPayment}
         disabled={loading}
       >
         {loading ? 'Processing...' : 'Subscribe'}
       </button>
       
       <div className="secure-checkout">
         <div className="secure-icon">🔒</div>
         <span>SECURE SSL CHECKOUT</span>
       </div>
     </div>
   );
 };

 // Render confirmation step
 const renderConfirmation = () => {
   return (
     <div className="confirmation-container">
       <div className="confirmation-icon">✅</div>
       <h2>Access Granted!</h2>
       <p>Thank you! You now have access to {getPlanDisplayName()}.</p>
       {!isFreeWithCoupon() && <p>A receipt has been sent to your email address.</p>}
       {orderId && (
         <p className="order-id">Order ID: #{orderId}</p>
       )}
       
       {/* Show product-specific confirmation message */}
       {selectedProduct && selectedProduct.fileUrl && (
         <div className="product-access-info" style={{
           backgroundColor: '#f0f9ff',
           border: '1px solid #0ea5e9',
           borderRadius: '8px',
           padding: '1rem',
           margin: '1rem 0'
         }}>
           <h3>Your Digital Product</h3>
           <p><strong>{selectedProduct.name}</strong></p>
           {selectedProduct.fileName && (
             <p>
               <a 
                 href={selectedProduct.fileUrl} 
                 target="_blank" 
                 rel="noopener noreferrer"
                 style={{
                   color: '#0ea5e9',
                   textDecoration: 'none',
                   fontWeight: '600'
                 }}
               >
                 📥 Download {selectedProduct.fileName}
               </a>
             </p>
           )}
         </div>
       )}
       
       <button 
         className="continue-button"
         onClick={() => navigate('/profile')}
       >
         Start Exploring Profiles
       </button>
     </div>
   );
 };

 return (
   <div className="checkout-page">
     <Navbar />
     
     <div className="checkout-content">
       <div className="container">
         <div className="checkout-wrapper">
           {renderCheckoutStep()}
         </div>
       </div>
     </div>
     
     {/* Auth Modal with preventRedirect prop */}
     <AuthModal 
       isOpen={showAuthModal}
       onClose={handleCloseAuthModal}
       onSuccess={handleAuthSuccess}
       initialMode={isLoginMode ? 'login' : 'signup'}
       preventRedirect={true}
       dataCollectionOnly={false}  // Allow guest option
     />
     <Footer />
   </div>
 );
};

export default Checkout;