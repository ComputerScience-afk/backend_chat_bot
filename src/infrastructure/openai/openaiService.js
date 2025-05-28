const { OpenAI } = require('openai');
const { logger } = require('../../utils/logger');
const fs = require('fs');
const path = require('path');

class OpenAIService {
    constructor() {
        this.retryAttempts = 3;
        this.retryDelay = 1000;
        this.maxTokens = 500;
        this.temperature = 0.7;
        this.model = process.env.OPENAI_MODEL || 'gpt-4';
        
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY is required');
        }
        
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });

        this.loadPrompt();
    }

    loadPrompt() {
        try {
            const promptPath = path.join(__dirname, 'prompt.txt');
            if (!fs.existsSync(promptPath)) {
                logger.error('Prompt file not found:', promptPath);
                throw new Error('Prompt file not found');
            }

            const rawPrompt = fs.readFileSync(promptPath, 'utf8');
            
            // Inject current date and time information for Peru
            const now = new Date();
            const peruTime = new Intl.DateTimeFormat('es-PE', {
                timeZone: 'America/Lima',
                dateStyle: 'full',
                timeStyle: 'long'
            }).format(now);
            
            this.systemPrompt = this.injectDateInformation(rawPrompt, peruTime);
            logger.info('System prompt loaded successfully with current date');
        } catch (error) {
            logger.error('Error loading prompt:', error);
            // Usar un prompt por defecto en caso de error
            this.systemPrompt = this.getDefaultPrompt();
        }
    }

    getDefaultPrompt() {
        return `Eres Antonio, un asistente médico virtual del Centro Médico INSALUD.
Tu objetivo es ayudar a los pacientes a programar citas y responder consultas médicas básicas.
Fecha actual en Perú: ${new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima' }).format(new Date())}`;
    }

    injectDateInformation(prompt, currentDateTime) {
        try {
            // Find the "Reglas sobre fechas" section and inject the current date
            const dateSection = "Reglas sobre fechas";
            const dateSectionIndex = prompt.indexOf(dateSection);
            
            if (dateSectionIndex === -1) {
                // If section not found, append at the end
                return prompt + `\n\nFecha y hora actual en Perú:\n${currentDateTime}\n`;
            }

            // Find the end of the date rules section
            const nextSectionIndex = prompt.indexOf('\n\n', dateSectionIndex + dateSection.length);
            const insertPosition = nextSectionIndex === -1 ? prompt.length : nextSectionIndex;

            // Insert the current date information
            return prompt.slice(0, insertPosition) + 
                   `\nFecha y hora actual en Perú: ${currentDateTime}\n` +
                   prompt.slice(insertPosition);
        } catch (error) {
            logger.error('Error injecting date information:', error);
            return prompt + `\n\nFecha y hora actual en Perú:\n${currentDateTime}\n`;
        }
    }

    async generateResponse(userMessage, imageBase64 = null) {
        let attempts = 0;
        
        while (attempts < this.retryAttempts) {
            try {
                const messages = [];
                
                // Agregar sistema de mensajes
                messages.push({
                    role: 'system',
                    content: 'Eres un asistente médico profesional y empático que ayuda a los pacientes de INSALUD.'
                });

                if (imageBase64) {
                    messages.push({
                        role: 'user',
                        content: [
                            { type: 'text', text: userMessage },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: imageBase64
                                }
                            }
                        ]
                    });
                } else {
                    messages.push({
                        role: 'user',
                        content: userMessage
                    });
                }

                const completion = await this.openai.chat.completions.create({
                    model: this.model,
                    messages: messages,
                    max_tokens: this.maxTokens,
                    temperature: this.temperature,
                    presence_penalty: 0.6,
                    frequency_penalty: 0.5
                });

                return completion.choices[0].message.content;

            } catch (error) {
                attempts++;
                logger.error(`OpenAI API error (attempt ${attempts}/${this.retryAttempts}):`, error);

                // Manejar errores específicos
                if (error.status === 429) {
                    // Rate limit - esperar más tiempo
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * 2));
                    continue;
                }

                if (error.status === 500 || error.status === 503) {
                    // Error de servidor - reintentar
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    continue;
                }

                if (attempts === this.retryAttempts) {
                    // Errores específicos después de todos los intentos
                    if (error.code === 'context_length_exceeded') {
                        return "Tu mensaje es demasiado largo. Por favor, intenta ser más conciso o divide tu consulta en mensajes más cortos.";
                    }
                    
                    if (error.code === 'rate_limit_exceeded') {
                        return "Estamos experimentando mucha demanda en este momento. Por favor, espera unos minutos antes de intentar nuevamente.";
                    }
                    
                    if (error.code === 'invalid_api_key') {
                        logger.error('Invalid OpenAI API key');
                        return "Lo siento, hay un problema de configuración. Por favor, contacta al administrador.";
                    }

                    // Error genérico después de todos los intentos
                    return "Lo siento, hubo un problema al procesar tu consulta. Por favor, intenta nuevamente en unos momentos.";
                }

                // Esperar antes del siguiente intento
                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
        }
    }

    async transcribeAudioBuffer(audioBuffer) {
        try {
            // Crear un archivo temporal
            const tempDir = path.join(__dirname, '../../../temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempFilePath = path.join(tempDir, `audio_${Date.now()}.ogg`);
            fs.writeFileSync(tempFilePath, audioBuffer);

            logger.info('Transcribing audio file...');

            const transcription = await this.openai.audio.transcriptions.create({
                file: fs.createReadStream(tempFilePath),
                model: "whisper-1",
            });

            // Limpiar archivo temporal
            fs.unlinkSync(tempFilePath);

            logger.info('Audio transcription completed:', transcription.text);
            return transcription.text;
        } catch (error) {
            logger.error('Error transcribing audio:', error);
            throw error;
        }
    }
}

// Exportar la clase directamente
module.exports = OpenAIService; 