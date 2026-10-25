import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import Footer from './components/layout/Footer';
import Home from './pages/Home';
import Services from './pages/Services';
import Vehicles from './pages/Vehicles';
import About from './pages/About';
import ClaimAssistance from './pages/ClaimAssistance';
import Contact from './pages/Contact';
import GetInTouch from './pages/GetInTouch';
import ScrollToTop from './components/utils/ScrollToTop';
import Login from './pages/admin/Login';
import Dashboard from './pages/admin/Dashboard';
import EnquiryList from './pages/admin/EnquiryList';
import EnquiryDetail from './pages/admin/EnquiryDetail';
import ProtectedRoute from './components/admin/ProtectedRoute';
import NotFound from './pages/NotFound';
import FloatingActions from './components/common/FloatingActions';

function App() {
  return (
    <Router>
      <ScrollToTop />
      <div className="min-h-screen flex flex-col font-sans text-text-secondary bg-white dark:bg-brand-darkBg dark:text-text-darkSecondary">
        <Routes>
          <Route path="/admin/*" element={null} />
          <Route path="*" element={<Navbar />} />
        </Routes>
        <div className="flex-grow">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/services" element={<Services />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/about" element={<About />} />
            <Route path="/claim-assistance" element={<ClaimAssistance />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/get-in-touch" element={<GetInTouch />} />
            
            {/* Admin Routes */}
            <Route path="/admin/login" element={<Login />} />
            <Route 
              path="/admin/dashboard" 
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin/enquiries" 
              element={
                <ProtectedRoute>
                  <EnquiryList />
                </ProtectedRoute>
              } 
            />
            <Route 
              path="/admin/enquiries/:id" 
              element={
                <ProtectedRoute>
                  <EnquiryDetail />
                </ProtectedRoute>
              } 
            />

            {/* Catch-all 404 Route */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        
        {/* Only show public footer if not on admin routes */}
        <Routes>
          <Route path="/admin/*" element={null} />
          <Route path="*" element={<Footer />} />
        </Routes>

        <FloatingActions />
      </div>
    </Router>
  );
}

export default App;
