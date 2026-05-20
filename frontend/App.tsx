import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Plans from './pages/Plans';
import Checkout from './pages/Checkout';
import ThankYou from './pages/ThankYou';

const App: React.FC = () => {
  useEffect(() => {
    if (document.getElementById('razorpay-checkout-js')) return;
    const script = document.createElement('script');
    script.id = 'razorpay-checkout-js';
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/" element={<Plans />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/success" element={<ThankYou />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
};

export default App;
