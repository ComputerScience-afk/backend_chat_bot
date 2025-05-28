const { logger } = require('../../utils/logger');
const path = require('path');
const fs = require('fs');

// Estados posibles de la conversación
const CONVERSATION_STATES = {
    INITIAL: 'INITIAL',
    WAITING_NAME: 'WAITING_NAME',
    WAITING_LOCATION: 'WAITING_LOCATION',
    WAITING_SYMPTOMS: 'WAITING_SYMPTOMS',
    COLLECTING_INFO: 'COLLECTING_INFO',
    SCHEDULING: 'SCHEDULING',
    FINISHED: 'FINISHED'
};

class ConversationStateService {
    constructor() {
        this.conversations = new Map();
        this.lastInteraction = new Map();
        this.maxConcurrentConversations = 100; // Límite de conversaciones simultáneas
        this.conversationTimeout = 30 * 60 * 1000; // 30 minutos
        this.persistencePath = path.join(process.cwd(), 'data', 'conversations.json');
        
        // Cargar estados persistentes
        this.loadPersistedStates();
        
        // Limpiar conversaciones inactivas cada hora
        setInterval(() => this.cleanupInactiveConversations(), 3600000);
        
        // Guardar estados cada 5 minutos
        setInterval(() => this.persistStates(), 300000);
    }

    async loadPersistedStates() {
        try {
            if (fs.existsSync(this.persistencePath)) {
                const data = JSON.parse(fs.readFileSync(this.persistencePath, 'utf8'));
                this.conversations = new Map(Object.entries(data.conversations));
                this.lastInteraction = new Map(Object.entries(data.lastInteraction));
                logger.info('Conversation states loaded from persistence');
            }
        } catch (error) {
            logger.error('Error loading persisted states:', error);
        }
    }

    async persistStates() {
        try {
            const data = {
                conversations: Object.fromEntries(this.conversations),
                lastInteraction: Object.fromEntries(this.lastInteraction)
            };
            fs.writeFileSync(this.persistencePath, JSON.stringify(data, null, 2));
            logger.info('Conversation states persisted successfully');
        } catch (error) {
            logger.error('Error persisting states:', error);
        }
    }

    getCurrentState(userId) {
        if (!this.conversations.has(userId)) {
            // Verificar límite de conversaciones
            if (this.conversations.size >= this.maxConcurrentConversations) {
                throw new Error('Maximum concurrent conversations limit reached');
            }
            this.initializeConversation(userId);
        }
        return this.conversations.get(userId);
    }

    initializeConversation(userId) {
        const newState = {
            state: CONVERSATION_STATES.INITIAL,
            data: {
                name: null,
                location: null,
                symptoms: [],
                lastUpdate: new Date(),
                hasBeenGreeted: false,
                leadProcessed: false
            }
        };
        this.conversations.set(userId, newState);
        this.updateLastInteraction(userId);
        return newState;
    }

    updateState(userId, newState, additionalData = {}) {
        const currentState = this.getCurrentState(userId);
        const updatedState = {
            state: newState,
            data: {
                ...currentState.data,
                ...additionalData,
                lastUpdate: new Date()
            }
        };
        
        // Validar estado antes de actualizar
        this.validateState(updatedState);
        
        this.conversations.set(userId, updatedState);
        this.updateLastInteraction(userId);
        logger.info(`Updated state for user ${userId}:`, updatedState);
        
        // Persistir cambios importantes
        if (newState === CONVERSATION_STATES.FINISHED) {
            this.persistStates();
        }
        
        return updatedState;
    }

    validateState(state) {
        if (!state || typeof state !== 'object') {
            throw new Error('Invalid state object');
        }
        
        if (!CONVERSATION_STATES[state.state]) {
            throw new Error('Invalid conversation state');
        }
        
        if (!state.data || typeof state.data !== 'object') {
            throw new Error('Invalid state data');
        }
        
        return true;
    }

    updateLastInteraction(userId) {
        this.lastInteraction.set(userId, new Date());
    }

    hasBeenGreetedToday(userId) {
        const state = this.getCurrentState(userId);
        if (!state.data.hasBeenGreeted) {
            return false;
        }

        const lastUpdate = new Date(state.data.lastUpdate);
        const now = new Date();
        
        // Convertir a UTC-5 (Perú)
        const peruTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
        const lastUpdatePeru = new Date(lastUpdate.getTime() - (5 * 60 * 60 * 1000));

        // Verificar si es el mismo día en UTC-5
        return peruTime.toDateString() === lastUpdatePeru.toDateString();
    }

    isFirstTimeUser(userId) {
        // Un usuario es primera vez si no existe en el mapa de conversaciones
        return !this.conversations.has(userId);
    }

    hasEverBeenGreeted(userId) {
        const state = this.getCurrentState(userId);
        return state.data.hasBeenGreeted || false;
    }

    markAsGreeted(userId) {
        const currentState = this.getCurrentState(userId);
        this.updateState(userId, currentState.state, {
            hasBeenGreeted: true
        });
    }

    isLeadProcessedToday(userId) {
        const state = this.getCurrentState(userId);
        if (!state.data.leadProcessed) {
            return false;
        }

        const lastUpdate = new Date(state.data.lastUpdate);
        const now = new Date();
        
        // Convertir a UTC-5 (Perú)
        const peruTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
        const lastUpdatePeru = new Date(lastUpdate.getTime() - (5 * 60 * 60 * 1000));

        // Verificar si es el mismo día en UTC-5
        return peruTime.toDateString() === lastUpdatePeru.toDateString();
    }

    markLeadAsProcessed(userId) {
        const currentState = this.getCurrentState(userId);
        this.updateState(userId, currentState.state, {
            leadProcessed: true
        });
    }

    buildContextSummary(userId) {
        const state = this.getCurrentState(userId);
        let summary = '';

        if (state.data.name) {
            summary += `[NOMBRE: ${state.data.name}]\n`;
        }

        if (state.data.location) {
            summary += `[UBICACIÓN: ${state.data.location}]\n`;
        }

        if (state.data.symptoms && state.data.symptoms.length > 0) {
            summary += `[SÍNTOMAS MENCIONADOS: ${state.data.symptoms.join(', ')}]\n`;
        }

        if (state.data.lastAppointment) {
            summary += `[ÚLTIMA CITA: ${state.data.lastAppointment}]\n`;
        }

        return summary;
    }

    getPersonalInfo(userId) {
        const state = this.getCurrentState(userId);
        return {
            name: state.data.name || null,
            location: state.data.location || null,
            symptoms: state.data.symptoms || [],
            lastAppointment: state.data.lastAppointment || null
        };
    }

    getLastAppointment(userId) {
        const state = this.getCurrentState(userId);
        return state.data.lastAppointment || null;
    }

    getRecentInteractions(userId, limit = 3) {
        const state = this.getCurrentState(userId);
        return state.data.recentInteractions || [];
    }

    cleanupInactiveConversations() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [userId, timestamp] of this.lastInteraction.entries()) {
            if (now - timestamp > this.conversationTimeout) {
                // Persistir conversación antes de limpiarla
                const state = this.conversations.get(userId);
                if (state && state.state !== CONVERSATION_STATES.FINISHED) {
                    state.state = CONVERSATION_STATES.FINISHED;
                    this.persistStates();
                }
                
                this.conversations.delete(userId);
                this.lastInteraction.delete(userId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} inactive conversations`);
        }
    }

    resetState(userId) {
        this.conversations.delete(userId);
        this.lastInteraction.delete(userId);
        logger.info(`Reset conversation state for user: ${userId}`);
    }
}

module.exports = {
    ConversationStateService,
    CONVERSATION_STATES
}; 