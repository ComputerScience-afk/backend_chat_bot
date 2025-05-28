require('dotenv').config();
const express = require('express');
const cors = require('cors');
const WhatsAppService = require('./src/infrastructure/whatsapp/whatsappService');
const { logger } = require('./src/utils/logger');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const UserTrackingService = require('./src/application/services/UserTrackingService');
const MessageHandler = require('./src/application/messageHandler');
const http = require('http');
const socketIo = require('socket.io');

// Suprimir warning de punycode
process.removeAllListeners('warning');
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning' && warning.message.includes('punycode')) {
        return;
    }
    console.warn(warning.name, warning.message);
});

// Configuración de Express (mantener para health checks y posibles webhooks futuros)
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const userTrackingService = new UserTrackingService();
const whatsappService = new WhatsAppService();
let messageHandler = null;
let qrCodeUrl = null;
let isWhatsAppReady = false;

// Configuración de WebSocket
io.on('connection', (socket) => {
    logger.info('New client connected');

    // Enviar estado inicial
    socket.emit('whatsapp-status', {
        isReady: isWhatsAppReady,
        qrCode: qrCodeUrl
    });

    // Enviar datos iniciales del Excel
    sendExcelData(socket);

    socket.on('disconnect', () => {
        logger.info('Client disconnected');
    });
});

// Función para enviar datos del Excel
async function sendExcelData(socket) {
    try {
        const stats = await userTrackingService.getStats();
        socket.emit('excel-data', stats);
    } catch (error) {
        logger.error('Error sending Excel data:', error);
    }
}

// Función para actualizar datos del Excel cada 5 minutos
setInterval(() => {
    io.emit('excel-data', userTrackingService.getStats());
}, 5 * 60 * 1000);

// Configuración del cliente WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// Eventos del cliente WhatsApp
client.on('qr', (qr) => {
    qrCodeUrl = qr;
    isWhatsAppReady = false;
    
    // Forzar limpieza de consola
    process.stdout.write('\x1Bc');
    
    console.log('\n==================================================');
    console.log('🔄 NUEVO CÓDIGO QR GENERADO - ESCANEA CON WHATSAPP');
    console.log('==================================================\n');
    
    // Generar QR de manera síncrona
    try {
        qrcode.generate(qr, { small: true });
        logger.info('Código QR generado exitosamente');
    } catch (error) {
        logger.error('Error al generar QR:', error);
        console.log('QR Code:', qr);
    }
    
    // Emitir QR a todos los clientes conectados
    io.emit('whatsapp-status', {
        isReady: false,
        qrCode: qr
    });
});

client.on('ready', async () => {
    try {
        logger.info('[WhatsApp] Client is ready!');
        isWhatsAppReady = true;
        qrCodeUrl = null;
        
        // Emitir estado a todos los clientes conectados
        io.emit('whatsapp-status', {
            isReady: true,
            qrCode: null
        });

        await whatsappService.setClient(client);
        messageHandler = new MessageHandler(client);
        await messageHandler.initialize();
        
        logger.info('WhatsApp service and message handler initialized successfully');
    } catch (error) {
        logger.error('Error initializing WhatsApp service:', error);
    }
});

client.on('authenticated', () => {
    logger.info('WhatsApp client authenticated successfully');
});

client.on('auth_failure', (error) => {
    logger.error('WhatsApp authentication failed:', error);
    isWhatsAppReady = false;
    qrCodeUrl = null;
    
    // Emitir estado a todos los clientes conectados
    io.emit('whatsapp-status', {
        isReady: false,
        qrCode: null
    });
});

client.on('disconnected', (reason) => {
    logger.warn('WhatsApp client disconnected:', reason);
    isWhatsAppReady = false;
    qrCodeUrl = null;
    
    // Emitir estado a todos los clientes conectados
    io.emit('whatsapp-status', {
        isReady: false,
        qrCode: null
    });
});

// Ruta de salud
app.get('/health', (req, res) => {
    const status = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        whatsapp: {
            connected: isWhatsAppReady
        },
        services: {
            express: 'running',
            whatsapp_web: isWhatsAppReady ? 'connected' : 'disconnected'
        }
    };
    
    res.status(isWhatsAppReady ? 200 : 503).json(status);
});

// Ruta para obtener información del bot
app.get('/info', (req, res) => {
    res.json({
        name: 'WhatsApp GPT Bot',
        version: '1.0.0',
        description: 'Bot de WhatsApp integrado con GPT-4 usando whatsapp-web.js',
        status: isWhatsAppReady ? 'active' : 'inactive',
        features: [
            'Integración con GPT-4',
            'Comandos personalizados',
            'Rate limiting automático',
            'Manejo de errores robusto',
            'Soporte para multimedia'
        ]
    });
});

// Ruta para enviar mensajes programáticamente (opcional, para testing)
app.post('/send-message', async (req, res) => {
    try {
        const { to, message } = req.body;
        
        if (!to || !message) {
            return res.status(400).json({ 
                error: 'Los campos "to" y "message" son requeridos' 
            });
        }

        if (!isWhatsAppReady) {
            return res.status(503).json({ 
                error: 'El cliente de WhatsApp no está conectado' 
            });
        }

        await whatsappService.sendMessage(to, message);
        
        res.json({ 
            success: true, 
            message: 'Mensaje enviado correctamente',
            to: to
        });
    } catch (error) {
        logger.error('Error en /send-message:', error);
        res.status(500).json({ 
            error: 'Error al enviar mensaje',
            details: error.message 
        });
    }
});

// Ruta para obtener estadísticas del bot (opcional)
app.get('/stats', (req, res) => {
    const client = whatsappService.getClient();
    if (!client || !isWhatsAppReady) {
        return res.status(503).json({ 
            error: 'Cliente de WhatsApp no disponible' 
        });
    }

    res.json({
        uptime: process.uptime(),
        memory_usage: process.memoryUsage(),
        whatsapp_status: 'connected',
        timestamp: new Date().toISOString()
    });
});

// Mantener webhook endpoints para compatibilidad (opcional)
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
            logger.info('Webhook verified successfully');
            res.status(200).send(challenge);
        } else {
            logger.warn('Webhook verification failed');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
});

// Webhook para recibir mensajes (fallback, normalmente se usa whatsapp-web.js)
app.post('/webhook', async (req, res) => {
    try {
        const { body } = req;
        
        if (body.object) {
            if (body.entry && 
                body.entry[0].changes && 
                body.entry[0].changes[0].value.messages && 
                body.entry[0].changes[0].value.messages[0]
            ) {
                const message = body.entry[0].changes[0].value.messages[0];
                await whatsappService.handleIncomingMessage(message);
            }
            res.status(200).send('EVENT_RECEIVED');
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        logger.error('Error processing webhook:', error);
        res.sendStatus(500);
    }
});

// WhatsApp Status Endpoint
app.get('/api/whatsapp/status', (req, res) => {
    logger.info('[API] WhatsApp status check requested');
    res.json({
        isReady: isWhatsAppReady,
        qrCodeUrl: qrCodeUrl
    });
});

// Stats Endpoint
app.get('/api/stats', async (req, res) => {
    try {
        logger.info('[API] Stats requested');
        const stats = await userTrackingService.getStats();
        res.json({
            ...stats,
            whatsappStatus: isWhatsAppReady
        });
    } catch (error) {
        logger.error('[API Error] Failed to get stats:', error);
        res.status(500).json({ error: 'Failed to get stats' });
    }
});

// Agregar el evento de mensaje
client.on('message', async (message) => {
    try {
        logger.info('[WhatsApp] Message received');
        await whatsappService.handleIncomingMessage(message);
        
        // Actualizar datos del Excel después de cada mensaje
        const stats = await userTrackingService.getStats();
        io.emit('excel-data', stats);
    } catch (error) {
        logger.error('Error handling message:', error);
        try {
            await client.sendMessage(message.from, 
                "Lo siento, hubo un error procesando tu mensaje. Por favor, intenta nuevamente en unos momentos.");
        } catch (sendError) {
            logger.error('Error sending error message:', sendError);
        }
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: err.message 
    });
});

// Manejo de errores no capturados
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Intentar cerrar gracefully
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Manejo de señales de terminación
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    await cleanup();
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('SIGINT received. Shutting down gracefully...');
    await cleanup();
    process.exit(0);
});

async function cleanup() {
    try {
        if (whatsappService) {
            await whatsappService.destroy();
        }
        logger.info('Cleanup completed successfully');
    } catch (error) {
        logger.error('Error during cleanup:', error);
    }
}

// Iniciar el servidor y el bot
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
});
