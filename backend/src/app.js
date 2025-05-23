import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';
import { initSocketIO } from './utils/socketio.js';
import { setupEventListeners } from './utils/eventEmitter.js';
import { broadcastDashboardUpdates, broadcastDashboardSectionUpdate, getRealtimeDashboardData } from './modules/admin/services/realtime.service.js';
import { checkMaintenanceMode } from './middleware/maintenanceMode.js';
import { isRedisHealthy, getCache } from './utils/redis.js';

// Load environment variables
dotenv.config();

// Import routes
import customerRoutes from './modules/customer/index.js';
import marketingRoutes from './modules/marketing/index.js';
import sellerRoutes from './modules/seller/index.js';
import adminRoutes from './modules/admin/index.js';
import pincodeRoutes from './modules/common/routes/pincode.routes.js';

// Dashboard update configuration with dynamic adjustment
const DASHBOARD_UPDATE_CONFIG = {
  initialInterval: parseInt(process.env.DASHBOARD_UPDATE_INTERVAL || 30) * 1000, // Default 30 seconds
  minInterval: 10 * 1000, // 10 seconds minimum
  maxInterval: 120 * 1000, // 120 seconds maximum
  loadFactorThreshold: parseInt(process.env.DASHBOARD_LOAD_THRESHOLD || 20), // Connected admin threshold
  scaleFactor: 1.5, // Increase interval by 1.5x under high load
};

// Create Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO
initSocketIO(server);

// Set up event listeners
setupEventListeners();

// Set up scheduled dashboard updates with dynamic interval
let dashboardUpdateInterval = DASHBOARD_UPDATE_CONFIG.initialInterval;
let updateIntervalId = null;

// Function to adjust update interval based on system load
const adjustUpdateInterval = () => {
  // Simplified version without checking connected admin count
  // Reset to initial interval
  dashboardUpdateInterval = DASHBOARD_UPDATE_CONFIG.initialInterval;
  
  // Clear existing interval and set new one
  if (updateIntervalId) {
    clearInterval(updateIntervalId);
  }
  
  updateIntervalId = setInterval(async () => {
    await broadcastDashboardUpdates();
  }, dashboardUpdateInterval);
  
  logger.info(`Dashboard update interval set to ${dashboardUpdateInterval / 1000}s`);
};

// Start with initial interval
updateIntervalId = setInterval(async () => {
  await broadcastDashboardUpdates();
}, dashboardUpdateInterval);

// Re-adjust interval every 5 minutes
setInterval(() => {
  adjustUpdateInterval();
}, 5 * 60 * 1000);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_ATLAS_URI)
  .then(() => {
    logger.info('Connected to MongoDB');
  })
  .catch((error) => {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  });

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', limiter);

// Specialized rate limit for dashboard endpoints
const dashboardLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // More strict limit for dashboard endpoints
  message: 'Too many dashboard requests from this IP, please try again later'
});
app.use('/api/admin/dashboard', dashboardLimiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message) => logger.info(message.trim())
  }
}));

// Maintenance mode middleware
app.use(checkMaintenanceMode);

// API routes
app.use('/api/customer', customerRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/pincodes', pincodeRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  // Get Redis status
  const redisStatus = isRedisHealthy();
  
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    dashboardUpdateInterval: `${dashboardUpdateInterval / 1000}s`,
    redis: redisStatus,
    mongo: {
      connected: mongoose.connection.readyState === 1
    }
  });
});

// Admin-only debugging endpoints
if (process.env.NODE_ENV === 'development') {
  // Redis cache inspection endpoint (only for development)
  app.get('/debug/redis/:key', async (req, res) => {
    try {
      const { key } = req.params;
      if (!key) {
        return res.status(400).json({ 
          success: false,
          error: 'No key provided'
        });
      }
      
      logger.debug(`Debug checking Redis key: ${key}`);
      
      const value = await getCache(key);
      
      return res.status(200).json({
        success: true,
        key,
        exists: value !== null,
        value,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Redis debug error: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  // Server status endpoint
  app.get('/debug/status', (req, res) => {
    const memoryUsage = process.memoryUsage();
    
    res.status(200).json({
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
      },
      redis: isRedisHealthy(),
      mongo: {
        connected: mongoose.connection.readyState === 1
      }
    });
  });
  
  // Dashboard data test endpoint
  app.get('/debug/dashboard/:section?', async (req, res) => {
    try {
      const { section } = req.params;
      const { force } = req.query;
      
      logger.debug(`Debug dashboard ${section ? `section ${section}` : 'all'}`);
      
      let data;
      
      if (section) {
        // If force is true, trigger a real-time update
        if (force === 'true') {
          await broadcastDashboardSectionUpdate(section);
          res.status(200).json({
            success: true,
            message: `Triggered update for section: ${section}`,
            timestamp: new Date().toISOString()
          });
          return;
        }
        
        // Import section-specific function
        const { updateDashboardSection } = await import('./modules/admin/services/realtime.service.js');
        data = await updateDashboardSection(section);
      } else {
        // If force is true, trigger a real-time update
        if (force === 'true') {
          await broadcastDashboardUpdates();
          res.status(200).json({
            success: true,
            message: 'Triggered full dashboard update',
            timestamp: new Date().toISOString()
          });
          return;
        }
        
        data = await getRealtimeDashboardData();
      }
      
      res.status(200).json({
        success: true,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`Dashboard debug error: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
}

// Error handling middleware
app.use(errorHandler);

// Handle 404 errors
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: 'The requested resource was not found'
  });
});

// Graceful shutdown handler
const gracefulShutdown = () => {
  logger.info('Received shutdown signal, closing connections...');
  
  // Clear any active intervals
  if (updateIntervalId) {
    clearInterval(updateIntervalId);
  }
  
  // Close server
  server.close(() => {
    logger.info('HTTP server closed');
    
    // Close database connection
    mongoose.connection.close(false, () => {
      logger.info('MongoDB connection closed');
      process.exit(0);
    });
  });
  
  // Force close if graceful shutdown fails
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Register shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const PORT = process.env.PORT || 8888;
server.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Promise Rejection:', error);
  // Log error but don't exit in production
  if (process.env.NODE_ENV !== 'production') {
  process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Log error but don't exit in production for non-fatal errors
  if (process.env.NODE_ENV !== 'production' || error.isOperational === false) {
  process.exit(1);
  }
});

export default app; 