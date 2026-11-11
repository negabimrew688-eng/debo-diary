import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout, { homeFor } from './components/Layout.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import { Spinner } from './components/ui.jsx';
import { Login, Register } from './pages/Auth.jsx';
const Profile = lazy(() => import('./pages/shared/Profile.jsx'));
const Orders = lazy(() => import('./pages/shared/Orders.jsx'));
const OrderDetail = lazy(() => import('./pages/shared/OrderDetail.jsx'));
const FarmerDashboard = lazy(() => import('./pages/farmer/Dashboard.jsx'));
const Batches = lazy(() => import('./pages/farmer/Batches.jsx'));
const BatchDetail = lazy(() => import('./pages/farmer/BatchDetail.jsx'));
const Cows = lazy(() => import('./pages/farmer/Cows.jsx'));
const FeedAdvice = lazy(() => import('./pages/farmer/FeedAdvice.jsx'));
const Byproducts = lazy(() => import('./pages/farmer/Byproducts.jsx'));
const Marketplace = lazy(() => import('./pages/buyer/Marketplace.jsx'));
const SupplierDemand = lazy(() => import('./pages/supplier/Demand.jsx'));
const SupplierProducts = lazy(() => import('./pages/supplier/Products.jsx'));
const SupplierOrders = lazy(() => import('./pages/supplier/Orders.jsx'));
const Notifications = lazy(() => import('./pages/shared/Notifications.jsx'));
const BuyerDashboard = lazy(() => import('./pages/buyer/Dashboard.jsx'));
const Market = lazy(() => import('./pages/buyer/Market.jsx'));
const Cart = lazy(() => import('./pages/buyer/Cart.jsx'));
const BuyerOrders = lazy(() => import('./pages/buyer/BuyerOrders.jsx'));
const BuyerOrderDetail = lazy(() => import('./pages/buyer/OrderDetail.jsx'));
const Addresses = lazy(() => import('./pages/buyer/Addresses.jsx'));
const FarmerProducts = lazy(() => import('./pages/farmer/Products.jsx'));
const ProductOrders = lazy(() => import('./pages/farmer/ProductOrders.jsx'));
const DeliveryDashboard = lazy(() => import('./pages/delivery/Dashboard.jsx'));
const Assignments = lazy(() => import('./pages/delivery/Assignments.jsx'));
const AssignmentDetail = lazy(() => import('./pages/delivery/AssignmentDetail.jsx'));
const Earnings = lazy(() => import('./pages/delivery/Earnings.jsx'));
const AdminProducts = lazy(() => import('./pages/admin/Products.jsx'));
const AdminDeliveries = lazy(() => import('./pages/admin/Deliveries.jsx'));
const AdminReviews = lazy(() => import('./pages/admin/Reviews.jsx'));
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/Users.jsx'));
const AdminDisputes = lazy(() => import('./pages/admin/Disputes.jsx'));
const AdminSettings = lazy(() => import('./pages/admin/Settings.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/Audit.jsx'));

function Guard({ roles, children }) {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}
const G = (roles, el) => <Guard roles={roles}>{el}</Guard>;

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return <Spinner />;
  return (
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route path="/farmer" element={G(['farmer'], <FarmerDashboard />)} />
        <Route path="/farmer/batches" element={G(['farmer'], <Batches />)} />
        <Route path="/farmer/batches/:id" element={G(['farmer'], <BatchDetail />)} />
        <Route path="/farmer/cows" element={G(['farmer'], <Cows />)} />
        <Route path="/farmer/feed" element={G(['farmer'], <FeedAdvice />)} />
        <Route path="/farmer/byproducts" element={G(['farmer'], <Byproducts mine />)} />
        <Route path="/farmer/products" element={G(['farmer'], <FarmerProducts />)} />
        <Route path="/farmer/product-orders" element={G(['farmer'], <ProductOrders />)} />
        <Route path="/buyer" element={G(['buyer'], <BuyerDashboard />)} />
        <Route path="/buyer/market" element={G(['buyer'], <Market />)} />
        <Route path="/buyer/cart" element={G(['buyer'], <Cart />)} />
        <Route path="/buyer/orders" element={G(['buyer'], <BuyerOrders />)} />
        <Route path="/buyer/orders/product/:id" element={G(['buyer'], <BuyerOrderDetail />)} />
        <Route path="/buyer/addresses" element={G(['buyer'], <Addresses />)} />
        <Route path="/buyer/byproducts" element={G(['buyer'], <Byproducts />)} />
        <Route path="/supplier" element={G(['feed_supplier'], <SupplierDemand />)} />
        <Route path="/supplier/products" element={G(['feed_supplier'], <SupplierProducts />)} />
        <Route path="/supplier/orders" element={G(['feed_supplier'], <SupplierOrders />)} />
        <Route path="/delivery" element={G(['transporter'], <DeliveryDashboard />)} />
        <Route path="/delivery/assignments" element={G(['transporter'], <Assignments />)} />
        <Route path="/delivery/assignments/:id" element={G(['transporter'], <AssignmentDetail />)} />
        <Route path="/delivery/earnings" element={G(['transporter'], <Earnings />)} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/orders" element={G(['farmer', 'buyer'], <Orders />)} />
        <Route path="/orders/:id" element={G(['farmer', 'buyer'], <OrderDetail />)} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route element={<Guard roles={['admin']}><AdminLayout /></Guard>}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/orders" element={<Orders />} />
        <Route path="/admin/orders/:id" element={<OrderDetail />} />
        <Route path="/admin/products" element={<AdminProducts />} />
        <Route path="/admin/deliveries" element={<AdminDeliveries />} />
        <Route path="/admin/reviews" element={<AdminReviews />} />
        <Route path="/admin/disputes" element={<AdminDisputes />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
        <Route path="/admin/audit" element={<AdminAudit />} />
        <Route path="/admin/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : '/login'} replace />} />
    </Routes>
    </Suspense>
  );
}
