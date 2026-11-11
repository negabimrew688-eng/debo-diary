import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { imageUpload } from '../middleware/upload.js';
import * as S from '../validation/schemas.js';
import * as auth from '../controllers/auth.controller.js';
import * as farmer from '../controllers/farmer.controller.js';
import * as market from '../controllers/marketplace.controller.js';
import * as orders from '../controllers/order.controller.js';
import * as transport from '../controllers/transport.controller.js';
import * as feed from '../controllers/feed.controller.js';
import * as byproduct from '../controllers/byproduct.controller.js';
import * as admin from '../controllers/admin.controller.js';
import * as product from '../controllers/product.controller.js';
import * as buyer from '../controllers/buyer.controller.js';
import * as delivery from '../controllers/delivery.controller.js';
import * as notif from '../controllers/notification.controller.js';
import * as assistant from '../controllers/assistant.controller.js';
import { badRequest } from '../utils/AppError.js';

export const router = Router();
const id = validate(S.idParam, 'params');
const as = (...roles) => [authenticate, authorize(...roles)];

// Auth
router.post('/auth/register', validate(S.registerSchema), auth.register);
router.post('/auth/login', validate(S.loginSchema), auth.login);
router.get('/auth/me', authenticate, auth.me);
router.patch('/auth/me', authenticate, validate(S.updateMeSchema), auth.updateMe);
router.post('/auth/change-password', authenticate, validate(S.changePasswordSchema), auth.changePassword);

// Image upload (milk photos, dispute evidence)
router.post('/uploads', authenticate, imageUpload.single('image'), (req, res, next) => {
  if (!req.file) return next(badRequest('Attach an image in the "image" field'));
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// Farmer
router.get('/farmer/dashboard', as('farmer'), farmer.dashboard);
router.get('/farmer/cows', as('farmer'), farmer.listCows);
router.post('/farmer/cows', as('farmer'), validate(S.cowSchema), farmer.createCow);
router.patch('/farmer/cows/:id', as('farmer'), id, validate(S.cowUpdateSchema), farmer.updateCow);
router.delete('/farmer/cows/:id', as('farmer'), id, farmer.deleteCow);
router.get('/farmer/batches', as('farmer'), farmer.listMyBatches);
router.post('/farmer/batches', as('farmer'), validate(S.batchSchema), farmer.createBatch);
router.get('/farmer/batches/:id', as('farmer'), id, farmer.getMyBatch);
router.post('/farmer/batches/:id/tests', as('farmer'), id, validate(S.testSchema), farmer.testBatch);
router.post('/farmer/batches/:id/list', as('farmer'), id, validate(S.listBatchSchema), farmer.listBatch);
router.post('/farmer/batches/:id/withdraw', as('farmer'), id, farmer.withdrawBatch);
router.get('/farmer/feed-recommendations', as('farmer'), farmer.feedRecommendations);

// Marketplace (buyers browse; farmers and admins may look too)
router.get('/marketplace/batches', as('buyer', 'farmer', 'admin'), validate(S.marketQuerySchema, 'query'), market.browse);
router.get('/marketplace/compare', as('buyer', 'admin'), validate(S.compareQuerySchema, 'query'), market.compare);
router.get('/marketplace/batches/:id', as('buyer', 'farmer', 'admin'), id, market.detail);

// Orders and escrow
router.get('/orders', as('buyer', 'farmer', 'transporter', 'admin'), orders.listOrders);
router.post('/orders', as('buyer'), validate(S.orderSchema), orders.createOrder);
router.get('/orders/:id', as('buyer', 'farmer', 'transporter', 'admin'), id, orders.getOrder);
router.post('/orders/:id/cancel', as('buyer'), id, orders.cancelOrder);
router.post('/orders/:id/pay', as('buyer'), id, orders.payOrder);
router.post('/orders/:id/payment/sandbox-confirm', as('buyer'), id, validate(S.sandboxPaySchema), orders.sandboxConfirmPayment);
router.post('/orders/:id/delivery', as('buyer', 'admin'), id, validate(S.deliveryRequestSchema), orders.requestDelivery);
router.post('/orders/:id/confirm-receipt', as('buyer'), id, validate(S.confirmSchema), orders.confirmReceipt);
router.post('/orders/:id/dispute', as('buyer'), id, validate(S.disputeSchema), orders.raiseDispute);

// Dairy products (catalogue) and seller management
router.get('/products/categories', authenticate, product.categories);
router.get('/products', as('buyer', 'farmer', 'admin'), validate(S.productQuerySchema, 'query'), product.browse);
router.get('/products/compare', as('buyer', 'admin'), product.compare);
router.get('/products/:id', as('buyer', 'farmer', 'admin'), id, product.detail);
router.get('/farmer/products', as('farmer'), product.mine);
router.post('/farmer/products', as('farmer'), validate(S.productSchema), product.create);
router.patch('/farmer/products/:id', as('farmer'), id, validate(S.productUpdateSchema), product.update);
router.delete('/farmer/products/:id', as('farmer'), id, product.remove);
router.get('/farmer/product-orders', as('farmer'), buyer.sellerOrders);
router.post('/farmer/product-orders/:id/status', as('farmer'), id, validate(S.sellerOrderStatusSchema), buyer.sellerSetStatus);

// Buyer: dashboard, cart, orders, addresses, reviews
router.get('/buyer/dashboard', as('buyer'), buyer.dashboard);
router.get('/buyer/cart', as('buyer'), buyer.getCart);
router.post('/buyer/cart', as('buyer'), validate(S.cartAddSchema), buyer.addToCart);
router.put('/buyer/cart/:id', as('buyer'), id, validate(S.cartUpdateSchema), buyer.updateCartItem);
router.delete('/buyer/cart/:id', as('buyer'), id, buyer.removeCartItem);
router.get('/buyer/orders', as('buyer'), buyer.listOrders);
router.post('/buyer/orders', as('buyer'), validate(S.checkoutSchema), buyer.checkout);
router.get('/buyer/orders/:id', as('buyer'), id, buyer.getOrderDetail);
router.post('/buyer/orders/:id/pay', as('buyer'), id, buyer.payOrder);
router.post('/buyer/orders/:id/payment/sandbox-confirm', as('buyer'), id, validate(S.sandboxPaySchema), buyer.sandboxConfirm);
router.post('/buyer/orders/:id/cancel', as('buyer'), id, buyer.cancelOrder);
router.post('/buyer/orders/:id/confirm', as('buyer'), id, buyer.confirmDelivery);
router.get('/buyer/orders/:id/receipt', as('buyer'), id, buyer.receipt);
router.get('/buyer/addresses', as('buyer'), buyer.listAddresses);
router.post('/buyer/addresses', as('buyer'), validate(S.addressSchema), buyer.createAddress);
router.put('/buyer/addresses/:id', as('buyer'), id, validate(S.addressUpdateSchema), buyer.updateAddress);
router.delete('/buyer/addresses/:id', as('buyer'), id, buyer.deleteAddress);
router.post('/buyer/reviews', as('buyer'), validate(S.reviewSchema), buyer.createReview);
router.get('/buyer/notifications', as('buyer'), notif.list);

// Notifications (all roles) and assistant
router.get('/notifications', authenticate, notif.list);
router.get('/notifications/unread-count', authenticate, notif.unreadCount);
router.post('/notifications/read', authenticate, validate(S.notificationReadSchema), notif.markRead);
router.post('/assistant/chat', authenticate, validate(S.assistantSchema), assistant.chat);

// Delivery partner (role "transporter")
router.get('/delivery/dashboard', as('transporter'), delivery.dashboard);
router.get('/delivery/assignments', as('transporter'), delivery.listAssignments);
router.get('/delivery/assignments/:id', as('transporter'), id, delivery.getAssignment);
router.post('/delivery/assignments/:id/accept', as('transporter'), id, delivery.accept);
router.post('/delivery/assignments/:id/reject', as('transporter'), id, delivery.reject);
router.post('/delivery/assignments/:id/pickup', as('transporter'), id, validate(S.dpActionSchema), delivery.pickup);
router.post('/delivery/assignments/:id/start', as('transporter'), id, delivery.start);
router.post('/delivery/assignments/:id/complete', as('transporter'), id, validate(S.dpCompleteSchema), delivery.complete);
router.post('/delivery/assignments/:id/location', as('transporter'), id, validate(S.dpLocationSchema), delivery.location);
router.get('/delivery/earnings', as('transporter'), delivery.earnings);
router.put('/delivery/profile', as('transporter'), validate(S.dpProfileSchema), delivery.updateProfile);
router.put('/delivery/availability', as('transporter'), validate(S.dpAvailabilitySchema), delivery.setAvailability);
router.get('/delivery/notifications', as('transporter'), notif.list);

// Transport
router.get('/transport/available', as('buyer', 'admin'), transport.availableTransporters);

// Feed
router.get('/feed/products', as('farmer', 'admin'), validate(S.feedQuerySchema, 'query'), feed.browseProducts);
router.get('/feed/my-products', as('feed_supplier'), feed.myProducts);
router.post('/feed/my-products', as('feed_supplier'), validate(S.feedProductSchema), feed.createProduct);
router.patch('/feed/my-products/:id', as('feed_supplier'), id, validate(S.feedProductUpdateSchema), feed.updateProduct);
router.delete('/feed/my-products/:id', as('feed_supplier'), id, feed.deleteProduct);
router.get('/feed/orders', as('farmer', 'feed_supplier'), feed.listFeedOrders);
router.post('/feed/orders', as('farmer'), validate(S.feedOrderSchema), feed.createFeedOrder);
router.post('/feed/orders/:id/status', as('farmer', 'feed_supplier'), id, validate(S.feedOrderStatusSchema), feed.updateFeedOrderStatus);
router.get('/feed/demand', as('feed_supplier'), feed.demand);

// Byproducts and compost
router.get('/byproducts', authenticate, byproduct.browse);
router.get('/byproducts/mine', as('farmer'), byproduct.mine);
router.post('/byproducts', as('farmer'), validate(S.byproductSchema), byproduct.create);
router.post('/byproducts/:id/status', as('farmer'), id, validate(S.byproductStatusSchema), byproduct.setStatus);

// Admin
router.get('/admin/stats', as('admin'), admin.stats);
router.get('/admin/trends', as('admin'), admin.trends);
router.get('/admin/users', as('admin'), validate(S.adminUsersQuery, 'query'), admin.listUsers);
router.patch('/admin/users/:id', as('admin'), id, validate(S.adminUserUpdateSchema), admin.updateUser);
router.get('/admin/tests', as('admin'), admin.allTests);
router.get('/admin/audit', as('admin'), admin.auditLogs);
router.get('/admin/disputes', as('admin'), orders.listDisputes);
router.post('/admin/disputes/:id/resolve', as('admin'), id, validate(S.resolveSchema), orders.resolveDispute);
router.get('/admin/settings', as('admin'), admin.getSettingsHandler);
router.put('/admin/settings', as('admin'), validate(S.settingsUpdateSchema), admin.updateSettings);
router.get('/admin/calibration', as('admin'), admin.listCalibration);
router.post('/admin/calibration', as('admin'), validate(S.calibrationSampleSchema), admin.addCalibrationSample);
router.post('/admin/calibration/preview', as('admin'), validate(S.previewSchema), admin.previewModel);
router.post('/admin/calibration/apply', as('admin'), admin.applyCalibration);
router.delete('/admin/calibration/active', as('admin'), admin.clearCalibration);

// Admin: catalogue, deliveries, earnings, reviews, assistant usage
router.get('/admin/categories', as('admin'), admin.listCategories);
router.post('/admin/categories', as('admin'), validate(S.categorySchema), admin.createCategory);
router.patch('/admin/categories/:id', as('admin'), id, validate(S.categoryUpdateSchema), admin.updateCategory);
router.get('/admin/products', as('admin'), admin.listProducts);
router.patch('/admin/products/:id', as('admin'), id, validate(S.adminProductUpdateSchema), admin.setProductStatus);
router.get('/admin/product-orders', as('admin'), admin.listProductOrders);
router.get('/admin/deliveries', as('admin'), admin.listDeliveries);
router.post('/admin/deliveries/assign', as('admin'), validate(S.adminAssignSchema), admin.assignDelivery);
router.get('/admin/earnings', as('admin'), admin.listEarnings);
router.post('/admin/earnings/:id/pay', as('admin'), id, admin.payEarning);
router.get('/admin/reviews', as('admin'), admin.listReviews);
router.get('/admin/ai-usage', as('admin'), admin.aiUsage);
