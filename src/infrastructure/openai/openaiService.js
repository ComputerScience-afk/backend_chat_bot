const { OpenAI } = require('openai');
const { logger } = require('../../utils/logger');
const fs = require('fs');
const path = require('path');
const { formatPeruDate, getCurrentPeruDate } = require('../../utils/dateUtils');

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
            this.basePrompt = rawPrompt;
            logger.info('Base prompt loaded successfully');
        } catch (error) {
            logger.error('Error loading prompt:', error);
            this.basePrompt = this.getDefaultPrompt();
        }
    }

    getDefaultPrompt() {
        return `Eres Antonio, un asistente médico virtual del Centro Médico INSALUD.
Tu objetivo es ayudar a los pacientes a programar citas y responder consultas médicas básicas.`;
    }

    getCurrentPrompt() {
        const currentDateTime = formatPeruDate(getCurrentPeruDate());
        return this.injectDateInformation(this.basePrompt, currentDateTime);
    }

    injectDateInformation(prompt, currentDateTime) {
        try {
            // Asegurarnos de que la información de fecha esté al principio del prompt
            const dateInfo = `[INFORMACIÓN ACTUAL]
- Fecha y hora actual en Perú: ${currentDateTime}
- Zona horaria: America/Lima
- Horario de atención: Lunes a Domingo de 8am a 8pm

`;
            // Si ya existe una sección de fecha, la reemplazamos
            const existingDateSection = prompt.match(/\[INFORMACIÓN ACTUAL\][\s\S]*?\n\n/);
            if (existingDateSection) {
                return prompt.replace(existingDateSection[0], dateInfo);
            }
            
            // Si no existe, la agregamos al principio
            return dateInfo + prompt;
        } catch (error) {
            logger.error('Error injecting date information:', error);
            return dateInfo + prompt;
        }
    }

    async generateResponse(userMessage, imageBase64 = null) {
        let attempts = 0;
        
        while (attempts < this.retryAttempts) {
            try {
                const messages = [];
                
                // Obtener el prompt actualizado con la fecha actual
                const currentPrompt = this.getCurrentPrompt();
                
                // Agregar el prompt del sistema con la fecha actualizada
                messages.push({
                    role: 'system',
                    content: currentPrompt
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

                if (error.status === 429) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * 2));
                    continue;
                }

                if (error.status === 500 || error.status === 503) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                    continue;
                }

                if (attempts === this.retryAttempts) {
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

                    return "Lo siento, hubo un problema al procesar tu consulta. Por favor, intenta nuevamente en unos momentos.";
                }

                await new Promise(resolve => setTimeout(resolve, this.retryDelay));
            }
        }
    }

    async transcribeAudioBuffer(audioBuffer) {
        try {
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

            fs.unlinkSync(tempFilePath);

            logger.info('Audio transcription completed:', transcription.text);
            return transcription.text;
        } catch (error) {
            logger.error('Error transcribing audio:', error);
            throw error;
        }
    }
}

module.exports = OpenAIService; 