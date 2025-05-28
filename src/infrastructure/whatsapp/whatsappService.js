const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { logger } = require('../../utils/logger');
const openaiService = require('../openai/openaiService');
const metaRepository = require('../repositories/MetaRepository');
const config = require('../config/config');
const MessageHandler = require('../../application/messageHandler');
const LeadTrackingService = require('../../application/services/LeadTrackingService');
const { getCurrentPeruDate, getPeruStartOfDay } = require('../../utils/dateUtils');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.messageHandler = null;
        this.leadTrackingService = new LeadTrackingService(null, null);
        
        // Sistema de bloqueo de chats
        this.activeChats = new Map(); // Chats actualmente en proceso
        this.chatLastInteraction = new Map(); // Última interacción por chat
        this.processingLock = new Map(); // Bloqueo de procesamiento por chat
        
        this.isReady = false;
        this.qrCode = null;
        
        // Configuraciones
        this.MAX_RETRIES = 3;
        this.RATE_LIMIT_DELAY = 2000; // 2 segundos entre mensajes
        this.CHAT_TIMEOUT = 300000; // 5 minutos de timeout para un chat
        this.PROCESSING_TIMEOUT = 30000; // 30 segundos máximo de procesamiento
        this.MESSAGE_BUFFER_TIMEOUT = 15000; // 15 segundos de espera para agrupar mensajes
        this.RECONNECT_DELAY = 5000;
        this.MAX_RECONNECT_ATTEMPTS = 5;
        this.reconnectAttempts = 0;
        this.connectionTimeout = null;
        this.messageQueue = new Map();
        this.processingQueue = false;
    }

    async setClient(client) {
        try {
            this.client = client;
            this.messageHandler = new MessageHandler(client);
            await this.messageHandler.initialize();
            this.isReady = true;
            this.setupEventHandlers();
            this.startQueueProcessor();
            logger.info('WhatsApp client and message handler initialized successfully');
        } catch (error) {
            logger.error('Error initializing WhatsApp service:', error);
            throw error;
        }
    }

    setupEventHandlers() {
        if (!this.client) {
            throw new Error('WhatsApp client not initialized');
        }

        this.client.on('qr', (qr) => {
            this.qrCode = qr;
            
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
                // Intento alternativo de mostrar QR
                console.log('QR Code:', qr);
            }
            
            this.lastQRTimestamp = Date.now();
            logger.info(`QR Code timestamp: ${this.lastQRTimestamp}`);
        });

        this.client.on('ready', () => {
            this.isReady = true;
            this.qrCode = null;
            logger.info('WhatsApp client is ready!');
        });

        this.client.on('authenticated', () => {
            logger.info('WhatsApp client authenticated successfully');
        });

        this.client.on('auth_failure', (error) => {
            logger.error('WhatsApp authentication failed:', error);
            this.isReady = false;
            this.handleAuthFailure();
        });

        this.client.on('disconnected', (reason) => {
            logger.warn('WhatsApp client disconnected:', reason);
            this.isReady = false;
            this.handleDisconnection(reason);
        });

        this.client.on('error', async (error) => {
            logger.error('WhatsApp client error:', error);
            if (error.message.includes('timeout') || error.message.includes('connection')) {
                await this.handleConnectionError(error);
            }
        });
    }

    async handleIncomingMessage(message) {
        if (!this.messageHandler) {
            logger.error('Message handler not initialized');
            throw new Error('Message handler not initialized');
        }

        const chatId = message.from;

        try {
            // Verificar si el chat está bloqueado
            if (this.processingLock.get(chatId)) {
                logger.info(`Chat ${chatId} está siendo procesado, ignorando nuevo mensaje`);
                return;
            }

            // Obtener la fecha actual en Perú
            const currentDate = getCurrentPeruDate();
            const startOfDay = getPeruStartOfDay(currentDate);
            
            // Verificar si es un nuevo día para este chat
            const lastInteraction = this.chatLastInteraction.get(chatId);
            const isNewDay = !lastInteraction || 
                           getPeruStartOfDay(new Date(lastInteraction)).getTime() < startOfDay.getTime();

            // Si es un nuevo día, resetear el estado del chat
            if (isNewDay) {
                this.activeChats.delete(chatId);
                logger.info(`Nuevo día detectado para chat ${chatId}, reseteando estado`);
            }

            // Actualizar última interacción
            this.chatLastInteraction.set(chatId, currentDate);

            // Establecer bloqueo de procesamiento
            this.processingLock.set(chatId, true);
            
            // Configurar timeout para liberar el bloqueo
            setTimeout(() => {
                this.processingLock.delete(chatId);
            }, this.PROCESSING_TIMEOUT);

            // Procesar el mensaje
            const response = await this.messageHandler.handleIncomingMessage(message);

            // Si hay respuesta, enviarla
            if (response) {
                await this.sendMessage(chatId, response);
            }

            // Actualizar estado del chat
            this.activeChats.set(chatId, {
                lastMessage: currentDate,
                isActive: true
            });

            // Programar limpieza del chat después del timeout
            setTimeout(() => {
                if (this.activeChats.has(chatId)) {
                    const chatInfo = this.activeChats.get(chatId);
                    const timeSinceLastMessage = Date.now() - new Date(chatInfo.lastMessage).getTime();
                    if (timeSinceLastMessage >= this.CHAT_TIMEOUT) {
                        this.activeChats.delete(chatId);
                        logger.info(`Chat ${chatId} cerrado por inactividad`);
                    }
                }
            }, this.CHAT_TIMEOUT);

        } catch (error) {
            logger.error('Error handling incoming message:', error);
            await this.handleError(chatId, error);
        } finally {
            // Asegurar que el bloqueo se libere
            this.processingLock.delete(chatId);
        }
    }

    async startQueueProcessor() {
        // Eliminar este método ya que ahora usamos el sistema de buffer
        return;
    }

    async handleConnectionError(error) {
        this.isReady = false;
        if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            const delay = this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1);
            logger.info(`Attempting reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
            
            if (this.connectionTimeout) {
                clearTimeout(this.connectionTimeout);
            }
            
            this.connectionTimeout = setTimeout(async () => {
                try {
                    await this.initialize();
                    this.reconnectAttempts = 0;
                    this.isReady = true;
                    logger.info('Reconnection successful');
                } catch (reconnectError) {
                    logger.error('Reconnection failed:', reconnectError);
                    await this.handleConnectionError(reconnectError);
                }
            }, delay);
        } else {
            logger.error('Max reconnection attempts reached');
            // Aquí podrías implementar una notificación al administrador
        }
    }

    async handleAuthFailure() {
        logger.error('Authentication failed - requiring manual intervention');
        this.isReady = false;
        // Aquí podrías implementar una notificación al administrador
    }

    async handleDisconnection(reason) {
        logger.warn(`Client disconnected: ${reason}`);
        this.isReady = false;
        await this.handleConnectionError(new Error(reason));
    }

    async handleError(chatId, error) {
        const errorMessage = 'Lo siento, hubo un error al procesar tu mensaje. Por favor, intenta nuevamente en unos momentos.';
        try {
            await this.sendMessage(chatId, errorMessage);
        } catch (sendError) {
            logger.error(`Failed to send error message to ${chatId}:`, sendError);
        }
    }

    async sendMessage(to, message) {
        try {
            if (!this.client || !this.isReady) {
                throw new Error('WhatsApp client not ready');
            }

            let retries = 0;
            const maxRetries = 3;

            while (retries < maxRetries) {
                try {
                    await this.client.sendMessage(to, message);
                    logger.info(`Message sent to ${to}`);
                    return;
                } catch (error) {
                    retries++;
                    if (retries === maxRetries) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                }
            }
        } catch (error) {
            logger.error('Error sending message:', error);
            throw error;
        }
    }

    async initialize() {
        try {
            if (this.client) {
                await this.client.initialize();
                this.isReady = true;
                logger.info('WhatsApp client initialized successfully');
            } else {
                throw new Error('WhatsApp client not set');
            }
        } catch (error) {
            logger.error('Error initializing WhatsApp client:', error);
            throw error;
        }
    }

    getQRCode() {
        return this.qrCode;
    }

    // Métodos de compatibilidad necesarios
    getClient() {
        return this.client;
    }

    isClientReady() {
        return this.isReady;
    }

    async logout() {
        if (this.client) {
            this.isReady = false;
            await this.client.logout();
        }
    }

    async destroy() {
        if (this.client) {
            this.isReady = false;
            await this.client.destroy();
        }
    }
}

module.exports = WhatsAppService; 