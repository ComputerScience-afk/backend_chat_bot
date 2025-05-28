const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { logger } = require('../../utils/logger');
const openaiService = require('../openai/openaiService');
const metaRepository = require('../repositories/MetaRepository');
const excelService = require('../services/ExcelService');
const config = require('../config/config');
const MessageHandler = require('../../application/messageHandler');

class WhatsAppService {
    constructor() {
        this.client = null;
        this.messageHandler = null;
        
        // Sistema de buffer mejorado
        this.chatBuffers = new Map(); // Buffer de mensajes por chat
        this.chatTimers = new Map(); // Timers por chat
        this.processingChats = new Set(); // Chats siendo procesados
        this.lastMessageTime = new Map(); // Control de rate limiting
        
        this.isReady = false;
        this.qrCode = null;
        
        // Configuraciones
        this.MAX_RETRIES = 3;
        this.RATE_LIMIT_DELAY = 2000; // 2 segundos entre mensajes
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
            // Si ya hay un timer para este chat, cancelarlo
            if (this.chatTimers.has(chatId)) {
                clearTimeout(this.chatTimers.get(chatId));
            }

            // Si no existe un buffer para este chat, crearlo
            if (!this.chatBuffers.has(chatId)) {
                this.chatBuffers.set(chatId, []);
            }

            // Agregar mensaje al buffer
            this.chatBuffers.get(chatId).push(message);

            // Configurar nuevo timer
            const timer = setTimeout(async () => {
                try {
                    if (this.processingChats.has(chatId)) {
                        return; // Ya se está procesando este chat
                    }

                    this.processingChats.add(chatId);
                    const messages = this.chatBuffers.get(chatId);
                    
                    if (!messages || messages.length === 0) {
                        this.processingChats.delete(chatId);
                        return;
                    }

                    // Usar el último mensaje como base pero combinar los textos
                    const lastMessage = messages[messages.length - 1];
                    const combinedText = messages.map(m => m.body).join(' ');
                    
                    // Crear una copia del último mensaje
                    const combinedMessage = Object.assign(Object.create(Object.getPrototypeOf(lastMessage)), lastMessage);
                    
                    // Actualizar solo el body con el texto combinado
                    combinedMessage.body = combinedText;

                    // Procesar el mensaje combinado
                    const response = await this.messageHandler.handleIncomingMessage(combinedMessage);

                    // Enviar respuesta si existe
                    if (response) {
                        await this.sendMessage(chatId, response);
                        logger.info('Response sent successfully');
                    }

                    // Limpiar buffer y timers
                    this.chatBuffers.delete(chatId);
                    this.chatTimers.delete(chatId);
                    this.processingChats.delete(chatId);
                } catch (error) {
                    logger.error('Error processing buffered messages:', error);
                    this.processingChats.delete(chatId);
                    await this.handleError(chatId, error);
                }
            }, this.MESSAGE_BUFFER_TIMEOUT);

            this.chatTimers.set(chatId, timer);
        } catch (error) {
            logger.error('Error handling incoming message:', error);
            await this.handleError(chatId, error);
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