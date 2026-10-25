import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MessageSquareText, MessageCircle, ChevronUp } from 'lucide-react';
import { useTranslation } from '../../i18n';
import contactInfo from '../../config/contactInfo';

/**
 * Coordinated Floating Action Group:
 * 1. Back to Top (appears after scrolling ~350px)
 * 2. WhatsApp (direct chat via wa.me)
 * 3. Send Enquiry (navigates to /get-in-touch or scrolls to form)
 */
const FloatingActions = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const [showBackToTop, setShowBackToTop] = useState(false);

  // Monitor scroll position for Back to Top visibility
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 350);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Do not render floating actions on admin portal routes
  if (location.pathname.startsWith('/admin')) {
    return null;
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleEnquiryClick = () => {
    if (location.pathname === '/get-in-touch') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const firstInput = document.querySelector('input[name="fullName"]');
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 300);
      }
    } else {
      navigate('/get-in-touch');
    }
  };

  return (
    <aside
      aria-label="Floating Actions"
      className="fixed bottom-6 right-4 sm:bottom-6 sm:right-6 z-40 flex flex-col items-end gap-2.5 sm:gap-3 pointer-events-none select-none pb-[env(safe-area-inset-bottom,0px)] pr-[env(safe-area-inset-right,0px)]"
    >
      {/* 1. Back to Top Button */}
      <div className="relative flex items-center justify-end group">
        <span
          role="tooltip"
          className="pointer-events-none absolute right-full mr-2.5 hidden md:block opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-2.5 py-1 text-xs font-medium text-white bg-brand-navy/90 dark:bg-black/90 backdrop-blur-sm rounded-md shadow-md whitespace-nowrap"
        >
          {t('floating.backToTop')}
        </span>
        <button
          type="button"
          onClick={scrollToTop}
          aria-label={t('floating.backToTop')}
          title={t('floating.backToTop')}
          tabIndex={showBackToTop ? 0 : -1}
          className={`pointer-events-auto w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center bg-white dark:bg-brand-darkSurface text-brand-navy dark:text-text-darkPrimary border border-ui-border dark:border-brand-darkBorder shadow-md hover:shadow-lg hover:bg-brand-light dark:hover:bg-brand-darkElevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sky focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-darkBg transition-all duration-300 transform motion-reduce:transition-none ${
            showBackToTop
              ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
              : 'opacity-0 translate-y-4 scale-90 pointer-events-none'
          }`}
        >
          <ChevronUp className="w-5 h-5 sm:w-6 sm:h-6" aria-hidden="true" />
        </button>
      </div>

      {/* 2. WhatsApp Button */}
      <div className="relative flex items-center justify-end group">
        <span
          role="tooltip"
          className="pointer-events-none absolute right-full mr-2.5 hidden md:block opacity-0 group-hover:opacity-100 transition-opacity duration-200 px-2.5 py-1 text-xs font-medium text-white bg-brand-navy/90 dark:bg-black/90 backdrop-blur-sm rounded-md shadow-md whitespace-nowrap"
        >
          {t('floating.chatWhatsapp')}
        </span>
        <a
          href={contactInfo.whatsapp.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('floating.chatWhatsapp')}
          title={t('floating.chatWhatsapp')}
          className="pointer-events-auto w-12 h-12 sm:w-13 sm:h-13 rounded-full flex items-center justify-center bg-[#25D366] hover:bg-[#20bd5a] text-white shadow-lg hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-darkBg transition-all duration-200 transform hover:scale-105 active:scale-95 motion-reduce:transition-none"
        >
          <MessageCircle className="w-6 h-6" aria-hidden="true" />
        </a>
      </div>

      {/* 3. Send Enquiry Button */}
      <div className="relative flex items-center justify-end group">
        <button
          type="button"
          onClick={handleEnquiryClick}
          aria-label={t('floating.sendEnquiryAria')}
          title={t('floating.sendEnquiry')}
          className="pointer-events-auto flex items-center gap-2 sm:gap-2.5 px-4 py-2.5 sm:px-5 sm:py-3 min-h-[44px] rounded-full shadow-lg hover:shadow-xl bg-brand-sky hover:bg-brand-strong text-brand-navy hover:text-white dark:text-brand-navy dark:hover:text-white font-semibold text-xs sm:text-sm tracking-wide transition-all duration-200 transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sky focus-visible:ring-offset-2 dark:focus-visible:ring-offset-brand-darkBg motion-reduce:transition-none"
        >
          <MessageSquareText className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" aria-hidden="true" />
          <span>{t('floating.sendEnquiry')}</span>
        </button>
      </div>
    </aside>
  );
};

export default FloatingActions;
