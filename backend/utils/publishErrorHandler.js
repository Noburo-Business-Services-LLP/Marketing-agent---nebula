/**
 * Centralized API error handler for all social media publishing services (Ayrshare, Meta, LinkedIn, X, Instagram, etc.).
 * Inspects raw API error messages/responses and returns a user-friendly, actionable object.
 */

function handlePublishError(rawError) {
  const errorString = String(rawError?.message || rawError?.error || rawError || '').toLowerCase();
  
  // Log the complete original API error for debugging
  console.error('[PublishErrorHandler] Original API Error:', rawError);

  if (errorString.includes('duplicate mention') || errorString.includes('mention is only allowed once per day') || errorString.includes('same @mention')) {
    return {
      success: false,
      errorCode: 'DUPLICATE_MENTION',
      message: "This post couldn't be published because the same @mention has already been used today. Please use the @mention only once per day or replace it with a hashtag (#) and try again."
    };
  }

  if (errorString.includes('too many hashtags') || errorString.includes('hashtag limit') || errorString.includes('maximum number of hashtags')) {
    return {
      success: false,
      errorCode: 'TOO_MANY_HASHTAGS',
      message: "This post couldn't be published because it contains too many hashtags. Please reduce the number of hashtags and try again."
    };
  }

  if (errorString.includes('invalid access token') || errorString.includes('expired access token') || errorString.includes('token expired') || errorString.includes('unauthorized') || errorString.includes('reconnect')) {
    return {
      success: false,
      errorCode: 'TOKEN_EXPIRED',
      message: "Your social media account connection has expired. Please reconnect your account and try again."
    };
  }

  if (errorString.includes('rate limit') || errorString.includes('too many requests') || errorString.includes('429')) {
    return {
      success: false,
      errorCode: 'RATE_LIMIT_EXCEEDED',
      message: "Publishing limit reached. Please wait a few minutes and try again."
    };
  }

  if (errorString.includes('permission denied') || errorString.includes('missing permissions') || errorString.includes('not authorized')) {
    return {
      success: false,
      errorCode: 'PERMISSION_DENIED',
      message: "Your account does not have permission to publish this post."
    };
  }

  if (errorString.includes('invalid media') || errorString.includes('unsupported media type') || errorString.includes('media failed') || errorString.includes('bad image') || errorString.includes('corrupted') || errorString.includes('resolution')) {
    return {
      success: false,
      errorCode: 'INVALID_MEDIA',
      message: "The selected image or video is not supported. Please upload a valid file."
    };
  }

  if (errorString.includes('timeout') || errorString.includes('econnreset') || errorString.includes('network error') || errorString.includes('socket hang up') || errorString.includes('failed to fetch')) {
    return {
      success: false,
      errorCode: 'NETWORK_TIMEOUT',
      message: "Unable to reach the publishing service. Please try again later."
    };
  }

  // Fallback for unknown errors
  return {
    success: false,
    errorCode: 'UNKNOWN_ERROR',
    message: "Unable to publish the post due to an unexpected error. Please try again."
  };
}

module.exports = {
  handlePublishError
};
