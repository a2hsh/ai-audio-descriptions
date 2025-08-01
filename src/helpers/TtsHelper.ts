import * as SpeechSdk from "microsoft-cognitiveservices-speech-sdk";
import { blobUri, blobSasToken, STORAGE_CONTAINER_NAME, aiServicesRegion, aiServicesKey } from "../keys";
import { Segment, SUPPORTED_LANGUAGES, LanguageConfig } from "../Models";
import { uploadToBlob } from "./BlobHelper";

const getLanguageConfig = (languageCode: string): LanguageConfig => {
    return SUPPORTED_LANGUAGES.find(lang => lang.code === languageCode) || SUPPORTED_LANGUAGES[0];
}

export const generateAudioFiles = async (scenes: Segment[], directory: string, setNumberOfAudioFilesGenerated: any, languageCode: string = 'en-US') => {
    console.log("generateAudioFiles called with languageCode:", languageCode);
    const langConfig = getLanguageConfig(languageCode);
    console.log("Using language config:", langConfig);
    
    const speechConfig: SpeechSdk.SpeechConfig = SpeechSdk.SpeechConfig.fromSubscription(aiServicesKey, aiServicesRegion);
    speechConfig.speechRecognitionLanguage = langConfig.speechRecognitionLanguage;
    speechConfig.speechSynthesisVoiceName = langConfig.voiceName;
    

    // Restore dynamic TTS speed calculation: default 1.5x, up to 2.0x if needed
    // Set base speaking rate (words per second) for each language
    let baseWordsPerSecond = 3;
    switch (languageCode) {
        case 'ar-SA':
        case 'ar-EG':
            baseWordsPerSecond = 2.5;
            break;
        case 'es-ES':
            baseWordsPerSecond = 3.2;
            break;
        case 'fr-FR':
            baseWordsPerSecond = 2.8;
            break;
        default:
            baseWordsPerSecond = 3;
    }

    for (let i = 0; i < scenes.length; i++) {
        const description = scenes[i].description || "";
        const wordCount = description.trim().split(/\s+/).length;
        // Calculate segment duration in seconds
        const start = scenes[i].startTime, end = scenes[i].endTime;
        // Accept both ms and HH:MM:SS or S format
        let startMs = typeof start === 'number' ? start : 0;
        let endMs = typeof end === 'number' ? end : 0;
        if (typeof start === 'string' && start.includes(':')) {
            const parts = start.split(':').map(Number);
            startMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        } else if (typeof start === 'string') {
            startMs = parseInt(start, 10);
        }
        if (typeof end === 'string' && end.includes(':')) {
            const parts = end.split(':').map(Number);
            endMs = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        } else if (typeof end === 'string') {
            endMs = parseInt(end, 10);
        }
        const durationSec = Math.max((endMs - startMs) / 1000, 0.1);
        // Default speed is 1.5x
        let ttsSpeedRatio = 1.5;
        // If narration is too long, increase speed up to 2.0x
        const neededRatio = wordCount / (durationSec * baseWordsPerSecond);
        if (neededRatio > 1.5) {
            ttsSpeedRatio = Math.min(neededRatio, 2.0);
        }
        // Optionally, you can set a minimum speed (e.g., 1.0)
        ttsSpeedRatio = Math.max(1.0, ttsSpeedRatio);

        // Convert ratio to SSML rate: 1.0 = 0%, 1.5 = +50%, 2.0 = +100%
        const ratePercent = ((ttsSpeedRatio - 1) * 100).toFixed(2);
        const rateString = ratePercent.startsWith('-') ? `${ratePercent}%` : `+${ratePercent}%`;
        const ssml = `
            <speak version='1.0' xml:lang='${langConfig.xmlLang}' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts'>
                <voice name='${langConfig.voiceName}'>
                    <prosody rate="${rateString}">
                        ${description}
                    </prosody>
                </voice>
            </speak>`;
        console.log(`SSML for scene ${i} (rate ${rateString}, duration ${durationSec.toFixed(2)}s, words ${wordCount}):`, ssml);
        const fileName = `${directory}_${i}.wav`;
        const speechSynthesizer = new SpeechSdk.SpeechSynthesizer(speechConfig, null!);
        await new Promise<void>((resolve, reject) => {
            speechSynthesizer.speakSsmlAsync(ssml, async (result: SpeechSdk.SpeechSynthesisResult) => {
                console.log(`TTS result for scene ${i}:`, result.reason, result.errorDetails);
                if (result.reason === SpeechSdk.ResultReason.SynthesizingAudioCompleted) {
                    await uploadToBlob(result.audioData, directory, fileName, null);
                    console.log(`Successfully uploaded audio file: ${fileName}`);
                } else {
                    console.error(`TTS failed for scene ${i}:`, result.errorDetails);
                }
                resolve();
            }, (error) => {
                console.error(`TTS error for scene ${i}:`, error);
                reject(error);
            });
        });
        if (setNumberOfAudioFilesGenerated) {
            setNumberOfAudioFilesGenerated(i + 1);
        }
    }
}

export const loadAudioFilesIntoMemory = async (title: string, audioDescriptions: Segment[], setAudioObjects: any, volume: number = 0.8) => {
    const audioObjects: HTMLAudioElement[] = [];
    
    // Function to preload a single .wav file
    const preloadAudio = (url: string) => {
        return new Promise((resolve, reject) => {
            const audio = new Audio();
            audio.src = url;
            audio.volume = volume;
            audio.preload = 'auto';
            audio.oncanplaythrough = () => resolve(audio);
            audio.onerror = () => reject(`Failed to load audio from: ${url}`);
        });
    }
    
    const urls = audioDescriptions.map((_, i) => {
        return `${blobUri}/${STORAGE_CONTAINER_NAME}/${title}/${title}_${i}.wav?${blobSasToken}`;
    });
    
    const promises = urls.map(url => preloadAudio(url));
    try {
        const loadedAudios = await Promise.all(promises);
        loadedAudios.forEach(audio => audioObjects.push(audio as HTMLAudioElement));
        console.log('All audio files preloaded successfully:', audioObjects.length);
        
        // Clear existing audio objects and set the new ones
        setAudioObjects([...audioObjects]);
    } catch (error) {
        console.error('Error loading audio files:', error);
    }
}