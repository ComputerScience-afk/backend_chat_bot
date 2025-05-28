const whatsappService = require('../infrastructure/whatsapp/whatsappService');
const OpenAIService = require('../infrastructure/openai/openaiService');
const cloudinaryService = require('../infrastructure/cloudinary/cloudinaryService');
const { logger } = require('../utils/logger');
const { ConversationStateService, CONVERSATION_STATES } = require('./services/ConversationStateService');
const UserTrackingService = require('./services/UserTrackingService');
const path = require('path');
const fs = require('fs');
const { setInterval } = require('timers');

class MessageHandler {
    constructor(client) {
        if (!client) {
            throw new Error('WhatsApp client is required for MessageHandler');
        }
        this.client = client;
        this.conversationState = new ConversationStateService();
        this.userTrackingService = new UserTrackingService();
        this.openaiService = new OpenAIService();
        this.initialized = false;
        
        // Límites para archivos
        this.maxImageSize = 5 * 1024 * 1024; // 5MB
        this.maxDocumentSize = 10 * 1024 * 1024; // 10MB
        this.allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif'];
        this.allowedDocumentTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        
        // Directorio temporal para archivos
        this.tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir);
        }
        
        // Limpiar archivos temporales cada hora
        setInterval(() => this.cleanupTempFiles(), 3600000);
    }

    async cleanupTempFiles() {
        try {
            const files = fs.readdirSync(this.tempDir);
            const now = Date.now();
            
            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = fs.statSync(filePath);
                
                // Eliminar archivos más antiguos de 1 hora
                if (now - stats.mtimeMs > 3600000) {
                    fs.unlinkSync(filePath);
                    logger.info(`Cleaned up temporary file: ${file}`);
                }
            }
        } catch (error) {
            logger.error('Error cleaning up temp files:', error);
        }
    }

    validateFile(media, type) {
        if (!media || !media.data) {
            throw new Error('Invalid media data');
        }

        const buffer = Buffer.from(media.data, 'base64');
        const fileSize = buffer.length;

        if (type === 'image') {
            if (fileSize > this.maxImageSize) {
                throw new Error('Image size exceeds limit');
            }
            if (!this.allowedImageTypes.includes(media.mimetype)) {
                throw new Error('Invalid image type');
            }
        } else if (type === 'document') {
            if (fileSize > this.maxDocumentSize) {
                throw new Error('Document size exceeds limit');
            }
            if (!this.allowedDocumentTypes.includes(media.mimetype)) {
                throw new Error('Invalid document type');
            }
        }

        return buffer;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            await this.userTrackingService.init();
            this.initialized = true;
            logger.info('MessageHandler initialized successfully');
        } catch (error) {
            logger.error('Error initializing MessageHandler:', error);
            throw error;
        }
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.initialize();
        }
    }

    async handleIncomingMessage(message) {
        await this.ensureInitialized();

        const tempFilePaths = [];
        try {
            // Ignorar mensajes propios
            if (message.fromMe) {
                logger.info('Ignoring own message');
                return null;
            }

            const userId = message.from;
            let response = null;

            try {
            // Procesar comandos primero
            if (message.body && message.body.startsWith('/')) {
                    response = await this.handleCommand(message, message.body);
                    return response;
                }

                let userInput = '';
                let imageBase64 = null;

                // Procesar contenido del mensaje
                if (message.body) {
                    userInput = message.body;
                }

                // Procesar imagen si existe
                if (message.hasMedia && message.type === 'image') {
                    try {
                        const media = await message.downloadMedia();
                        const buffer = this.validateFile(media, 'image');
                        
                        // Guardar temporalmente
                        const tempPath = path.join(this.tempDir, `img_${Date.now()}.${media.mimetype.split('/')[1]}`);
                        fs.writeFileSync(tempPath, buffer);
                        tempFilePaths.push(tempPath);
                        
                        await cloudinaryService.uploadImage(buffer);
                        imageBase64 = `data:${media.mimetype};base64,${media.data}`;
                    } catch (error) {
                        logger.error('Error processing image:', error);
                        return "Lo siento, hubo un problema procesando tu imagen. Por favor, asegúrate que sea menor a 5MB y en formato JPG, PNG o GIF.";
                    }
                }

                // Verificar el estado de saludo del usuario
                const isFirstTimeUser = this.conversationState.isFirstTimeUser(userId);
                const hasEverBeenGreeted = this.conversationState.hasEverBeenGreeted(userId);
                
                // Si es la primera vez que el usuario escribe, guardar en Excel inmediatamente
                if (isFirstTimeUser) {
                    try {
                        const leadData = {
                            phone: message.from.replace('@c.us', ''),
                            name: message._data?.notifyName || message._data?.pushname || 'No proporcionado',
                            location: 'No proporcionada',
                            symptoms: [],
                            source: 'WhatsApp',
                            campaignId: message._data?.ad_id || 'N/A'
                        };
                        await this.userTrackingService.trackUser(leadData);
                    } catch (error) {
                        logger.error('Error tracking first-time user:', error);
                        // Continuar con el proceso aunque falle el tracking
                    }
                }
                
                // Construir contexto para GPT incluyendo el historial de la conversación
                const conversationContext = this.buildConversationContext(userId, isFirstTimeUser, hasEverBeenGreeted);
                
                // Generar respuesta usando GPT con el contexto completo
                response = await this.generateIntelligentResponse(userInput, conversationContext, imageBase64);
                
                if (!response) {
                    throw new Error('No se pudo generar una respuesta');
                }

                // Extraer información estructurada de la respuesta del usuario
                const extractedData = await this.extractUserData(userInput, userId);
                
                // Actualizar estado de conversación
                if (extractedData.hasNewData) {
                    this.updateConversationState(userId, extractedData);
                }
                
                // Trackear objeciones si se detectan
                if (extractedData.objection_detected) {
                    try {
                        await this.trackObjection(message, extractedData);
                        await this.trackFreeConsultation(message, extractedData);
                    } catch (error) {
                        logger.error('Error tracking objection/consultation:', error);
                    }
                }
                
                // Procesar lead si tenemos información suficiente
                if (this.shouldProcessLead(extractedData, userId)) {
                    try {
                        await this.processLead(message, extractedData);
                        this.conversationState.markLeadAsProcessed(userId);
                    } catch (error) {
                        logger.error('Error processing lead:', error);
                    }
                }
                
                // Marcar como saludado si es la primera interacción
                if (isFirstTimeUser) {
                    this.conversationState.markAsGreeted(userId);
                }

                return response;

            } catch (processingError) {
                logger.error('Error processing message:', processingError);
                return "Lo siento, hubo un error procesando tu mensaje. ¿Podrías intentar escribirlo de otra manera?";
            }

        } catch (error) {
            logger.error('Critical error in handleIncomingMessage:', error);
            return "Lo siento, ocurrió un error inesperado. Por favor, intenta nuevamente en unos momentos.";
        } finally {
            // Limpiar archivos temporales
            for (const tempPath of tempFilePaths) {
                try {
                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                } catch (error) {
                    logger.error('Error cleaning up temp file:', error);
                }
            }
        }
    }

    buildConversationContext(userId, isFirstTimeUser, hasEverBeenGreeted) {
        const currentState = this.conversationState.getCurrentState(userId);
        const memorySummary = this.conversationState.buildContextSummary(userId);
        const lastAppointment = this.conversationState.getLastAppointment(userId);
        const recentInteractions = this.conversationState.getRecentInteractions(userId, 3);
        
        let context = "";
        
        // Agregar información de primera vez o retorno
        if (isFirstTimeUser) {
            context += "[PRIMERA CONVERSACIÓN ABSOLUTA - Usar mensaje inicial obligatorio]\n";
        } else if (hasEverBeenGreeted) {
            const personalInfo = this.conversationState.getPersonalInfo(userId);
            context += `[USUARIO RECURRENTE - Usar saludo personalizado: "¡Hola de nuevo, ${personalInfo.name || 'estimado'}! ¿En qué puedo ayudarte hoy?"]\n`;
        } else {
            context += "[USUARIO YA CONVERSÓ - Continuar conversación sin saludo inicial]\n";
        }
        
        // Agregar resumen de memoria
        context += memorySummary;
        
        // Agregar información sobre la última cita
        if (lastAppointment) {
            const appointmentDate = new Date(lastAppointment.date);
            const today = new Date();
            
            if (appointmentDate > today) {
                context += `[CITA PENDIENTE: ${appointmentDate.toLocaleDateString('es-PE')} - Recordar al usuario]\n`;
            } else if (appointmentDate.toDateString() === today.toDateString()) {
                context += `[CITA HOY: Preguntar cómo le fue en su cita]\n`;
            }
        }
        
        // Agregar información sobre interacciones recientes
        if (recentInteractions.length > 0) {
            context += "[INTERACCIONES RECIENTES:]\n";
            recentInteractions.forEach(interaction => {
                context += `- ${interaction.type}: ${interaction.details}\n`;
            });
        }
        
        return context;
    }

    async generateIntelligentResponse(userInput, conversationContext, imageBase64) {
        try {
            // Construir mensaje completo con contexto
            const fullMessage = `${conversationContext}\n\nMensaje del usuario: ${userInput}`;

            // Generar respuesta
            if (imageBase64) {
                return await this.openaiService.generateResponse(fullMessage, imageBase64);
            } else {
                return await this.openaiService.generateResponse(fullMessage);
            }

        } catch (error) {
            logger.error('Error generating intelligent response:', error);
            return "Lo siento, hubo un error al procesar tu consulta. ¿Podrías intentar nuevamente?";
        }
    }

    async extractUserData(messageBody, userId) {
        try {
            const currentState = this.conversationState.getCurrentState(userId);
            
            // Usar GPT para extraer información estructurada
            const extractionPrompt = `
            Analiza el siguiente mensaje y extrae ÚNICAMENTE la información específica mencionada.
            
            Mensaje: "${messageBody}"
            
            Responde SOLO en formato JSON válido con esta estructura:
            {
                "name": "nombre si se menciona, null si no",
                "location": "ubicación/distrito si se menciona, null si no", 
                "symptoms": ["lista de síntomas mencionados"],
                "objection_type": "precio|desinteres|comparacion|null",
                "objection_detected": true/false,
                "free_consultation_response": "acepta|rechaza|null",
                "hasNewData": true/false
            }
            
            Reglas:
            - Solo extraer información EXPLÍCITAMENTE mencionada
            - Para ubicación, reconocer distritos de Lima
            - Para síntomas, incluir cualquier molestia médica mencionada
            - Para objection_type: 
              * "precio" si menciona costo, caro, descuento, rebaja, promoción, dinero
              * "desinteres" si dice "lo voy a pensar", "después", "mejor no", "no me interesa"
              * "comparacion" si menciona buscar en otro lado, comparar precios, otras clínicas
              * null si no hay objeción
            - Para free_consultation_response:
              * "acepta" si dice "sí", "okay", "me parece bien", "acepto", "perfecto"
              * "rechaza" si dice "no", "no me interesa", "mejor no", "gracias pero no"
              * null si no responde sobre consulta gratuita
            - objection_detected: true si se detecta cualquier tipo de resistencia u objeción
            - Si no hay información nueva, hasNewData = false
            `;

            const extractionResponse = await this.openaiService.generateResponse(extractionPrompt);
            
            try {
                const extracted = JSON.parse(extractionResponse);
                
                // Combinar con datos existentes
                const result = {
                    name: extracted.name || currentState.data.name || null,
                    location: extracted.location || currentState.data.location || null,
                    symptoms: [
                        ...(currentState.data.symptoms || []),
                        ...(extracted.symptoms || [])
                    ],
                    objection_type: extracted.objection_type || null,
                    objection_detected: extracted.objection_detected || false,
                    free_consultation_response: extracted.free_consultation_response || null,
                    hasNewData: extracted.hasNewData || extracted.objection_detected || false
                };
                
                return result;
                
            } catch (parseError) {
                logger.error('Error parsing extraction response:', parseError);
                return {
                    name: currentState.data.name || null,
                    location: currentState.data.location || null,
                    symptoms: currentState.data.symptoms || [],
                    objection_type: null,
                    objection_detected: false,
                    free_consultation_response: null,
                    hasNewData: false
                };
            }

        } catch (error) {
            logger.error('Error extracting user data:', error);
            return {
                name: null,
                location: null,
                symptoms: [],
                objection_type: null,
                objection_detected: false,
                free_consultation_response: null,
                hasNewData: false
            };
        }
    }

    updateConversationState(userId, extractedData) {
        const updateData = {};
        
        if (extractedData.name) {
            updateData.name = extractedData.name;
        }
        
        if (extractedData.location) {
            updateData.location = extractedData.location;
        }
        
        if (extractedData.symptoms && extractedData.symptoms.length > 0) {
            updateData.symptoms = extractedData.symptoms;
        }
        
        // Guardar información de objeciones
        if (extractedData.objection_detected) {
            updateData.objection_type = extractedData.objection_type;
            updateData.has_shown_resistance = true;
        }
        
        if (Object.keys(updateData).length > 0) {
            this.conversationState.updateState(userId, CONVERSATION_STATES.COLLECTING_INFO, updateData);
        }
    }

    shouldProcessLead(extractedData, userId) {
        // Procesar lead si:
        // 1. Tenemos síntomas O ubicación
        // 2. No se ha procesado un lead hoy para este usuario
        const hasRelevantData = (extractedData.symptoms && extractedData.symptoms.length > 0) || extractedData.location;
        const notProcessedToday = !this.conversationState.isLeadProcessedToday(userId);
        
        return hasRelevantData && notProcessedToday;
    }

    async processLead(message, extractedData) {
        await this.ensureInitialized();

        try {
            const contact = await message.getContact();
            const leadData = {
                phone: message.from.replace('@c.us', ''),
                name: extractedData.name || contact.pushname || contact.name || 'No proporcionado',
                location: extractedData.location || 'No proporcionada',
                symptoms: extractedData.symptoms || [],
                source: 'WhatsApp',
                campaignId: message._data?.ad_id || 'N/A'
            };

            await this.userTrackingService.trackUser(leadData);
            logger.info('Lead processed successfully:', leadData);
            
            return true;
        } catch (error) {
            logger.error('Error processing lead:', error);
            return false;
        }
    }

    async trackObjection(message, extractedData) {
        await this.ensureInitialized();

        try {
            const contact = await message.getContact();
            const objectionData = {
                phone: message.from.replace('@c.us', ''),
                name: extractedData.name || contact.pushname || contact.name || 'No proporcionado',
                objection_type: extractedData.objection_type,
                originalMessage: message.body || ''
            };

            await this.userTrackingService.trackObjection(objectionData);
            logger.info('Objection tracked successfully:', objectionData);
            
            return true;
        } catch (error) {
            logger.error('Error tracking objection:', error);
            return false;
        }
    }

    async trackFreeConsultation(message, extractedData) {
        await this.ensureInitialized();

        try {
            const contact = await message.getContact();
            const freeConsultationData = {
                phone: message.from.replace('@c.us', ''),
                name: extractedData.name || contact.pushname || contact.name || 'No proporcionado',
                reason: extractedData.objection_type,
                response: extractedData.free_consultation_response || null
            };

            await this.userTrackingService.trackFreeConsultation(freeConsultationData);
            logger.info('Free consultation tracked successfully:', freeConsultationData);
            
            return true;
        } catch (error) {
            logger.error('Error tracking free consultation:', error);
            return false;
        }
    }

    async handleCommand(message, command) {
        const chatId = message.from;
        const contact = await message.getContact();
        const contactName = contact.name || contact.pushname || chatId;

        logger.info(`Processing command from ${contactName}: ${command}`);

        try {
        switch (command.toLowerCase()) {
            case '/help':
            case '/ayuda':
                    await this.client.sendMessage(chatId, 
                    "🤖 *Bot de WhatsApp con GPT-4*\n\n" +
                    "Comandos disponibles:\n" +
                    "• /help - Mostrar esta ayuda\n" +
                    "• /ping - Verificar que el bot está funcionando\n" +
                        "• /info - Información del bot\n" +
                        "• /reset - Reiniciar conversación\n\n" +
                    "Simplemente escríbeme cualquier mensaje y te responderé usando inteligencia artificial. 😊"
                );
                break;

            case '/ping':
                    await this.client.sendMessage(chatId, "🏓 Pong! El bot está funcionando correctamente.");
                break;

            case '/info':
                    await this.client.sendMessage(chatId,
                    "ℹ️ *Información del Bot*\n\n" +
                    "• Bot de WhatsApp integrado con GPT-4\n" +
                    "• Powered by whatsapp-web.js\n" +
                        "• Versión: 2.0.0\n" +
                    "• Estado: ✅ Activo"
                );
                break;

                case '/reset':
                    this.conversationState.resetState(message.from);
                    await this.client.sendMessage(chatId, "🔄 Conversación reiniciada. ¡Hola de nuevo!");
                    break;

            default:
                    await this.client.sendMessage(chatId, 
                    "❓ Comando no reconocido. Usa /help para ver los comandos disponibles."
                );
                break;
        }
        } catch (error) {
            logger.error('Error handling command:', error);
            await this.client.sendMessage(chatId, 
                "❌ Error procesando el comando. Por favor, intenta nuevamente."
            );
        }
    }
}

module.exports = MessageHandler; 