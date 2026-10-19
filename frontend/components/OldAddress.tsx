import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { redirectTarget } from '../utils/navMenu';

/** An old address (bookmark, old email, old tour step): opens its new place, keeps the query string, and replaces the history entry. */
const OldAddress: React.FC<{ from: string }> = ({ from }) => {
  const { search } = useLocation();
  return <Navigate to={redirectTarget(from, search)} replace />;
};

export default OldAddress;
