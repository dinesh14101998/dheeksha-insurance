import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X, Phone } from 'lucide-react';
import Container from './Container';
import Button from '../ui/Button';
import { Logo } from '../ui/Logo';
import ThemeToggle from '../common/ThemeToggle';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { useTranslation } from '../../i18n';

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();
  const { t } = useTranslation();

  const links = [
    { name: t('nav.home'), href: '/' },
    { name: t('nav.services'), href: '/services' },
    { name: t('nav.vehicles'), href: '/vehicles' },
    { name: t('nav.about'), href: '/about' },
    { name: t('nav.claimAssistance'), href: '/claim-assistance' },
  ];

  const isActive = (path) => {
    if (path === '/' && location.pathname !== '/') return false;
    if (path !== '/' && location.pathname.startsWith(path)) return true;
    return location.pathname === path;
  };

  return (
    <nav className="bg-white/95 dark:bg-brand-darkBg/95 backdrop-blur-md sticky top-0 z-50 border-b border-ui-border dark:border-brand-darkBorder shadow-sm transition-all duration-300">
      <Container>
        <div className="flex justify-between items-center h-20">
          {/* Logo */}
          <div className="flex-shrink-0 flex items-center">
            <Link to="/" className="inline-flex items-center p-1 rounded-xl transition-all duration-200 dark:bg-white dark:px-3.5 dark:py-1.5 md:dark:px-4 md:dark:py-2 dark:shadow-sm">
              <Logo />
            </Link>
          </div>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-6 lg:space-x-8">
            <div className="flex space-x-5 lg:space-x-6">
              {links.map((link) => (
                <Link
                  key={link.href}
                  to={link.href}
                  className={`font-medium transition-colors ${
                    isActive(link.href) 
                      ? 'text-brand-strong dark:text-brand-sky font-semibold' 
                      : 'text-text-secondary dark:text-text-darkSecondary hover:text-brand-strong dark:hover:text-brand-sky'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </div>
            
            <div className="flex items-center space-x-2.5 lg:space-x-3">
              <LanguageSwitcher id="desktop-language-switcher" />
              <ThemeToggle id="desktop-theme-toggle" />
              <Link to="/contact">
                <Button variant="primary" className="flex items-center gap-2">
                  <Phone size={18} />
                  {t('nav.getInTouch')}
                </Button>
              </Link>
            </div>
          </div>

          {/* Mobile menu button and theme/language controls */}
          <div className="md:hidden flex items-center space-x-1.5 sm:space-x-2">
            <LanguageSwitcher id="mobile-header-language-switcher" size="sm" />
            <ThemeToggle id="mobile-theme-toggle" />
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="text-brand-navy dark:text-text-darkPrimary hover:text-brand-strong dark:hover:text-brand-sky p-2 focus:outline-none"
              aria-label={t('nav.toggleMenu')}
            >
              {isOpen ? <X size={28} /> : <Menu size={28} />}
            </button>
          </div>
        </div>
      </Container>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-white dark:bg-brand-darkBg border-t border-ui-border dark:border-brand-darkBorder animate-fade-in shadow-xl">
          <div className="px-4 pt-3 pb-4 space-y-2">
            {/* Mobile Drawer Language Row */}
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-brand-light/60 dark:bg-brand-darkElevated/60 border border-ui-border/60 dark:border-brand-darkBorder/60 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary dark:text-text-darkSecondary">
                {t('nav.languageLabel')}
              </span>
              <LanguageSwitcher id="mobile-drawer-language-switcher" />
            </div>

            {links.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                onClick={() => setIsOpen(false)}
                className={`block px-3 py-3 text-base font-medium rounded-md transition-colors ${
                  isActive(link.href) 
                    ? 'text-brand-strong dark:text-brand-sky bg-brand-light dark:bg-brand-darkElevated font-semibold' 
                    : 'text-text-secondary dark:text-text-darkSecondary hover:text-brand-strong dark:hover:text-brand-sky hover:bg-brand-light dark:hover:bg-brand-darkElevated'
                }`}
              >
                {link.name}
              </Link>
            ))}
            <div className="mt-4 px-3 pt-2">
              <Link to="/contact" onClick={() => setIsOpen(false)}>
                <Button variant="primary" className="w-full flex justify-center items-center gap-2">
                  <Phone size={18} />
                  {t('nav.getInTouch')}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
