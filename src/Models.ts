export interface VideoPlayerProps {
    scenes: Segment[];
    setScenes: any;
    lastReadTime: number;
    setLastReadTime: any;
    allVideos: SavedVideoResult[];
    videoPlaying: boolean;
    setVideoPlaying: any;
    descriptionAvailable: boolean;
    setDescriptionAvailable: any;
    title: string;
    setTitle: any;
    videoListLoading: boolean;
    audioObjects: HTMLAudioElement[];
    setAudioObjects: any;
    onVideoDeleted: () => void;
    originalVideoVolume: number;
    setOriginalVideoVolume: any;
    audioDescriptionVolume: number;
    setAudioDescriptionVolume: any;
    selectedLanguage: string;
    setSelectedLanguage: any;
    fadeInDuration: number;
    setFadeInDuration: any;
    fadeOutDuration: number;
    setFadeOutDuration: any;
    duckingEnabled: boolean;
    setDuckingEnabled: any;
}

export interface DescriptionTableProps {
    scenes: Segment[];
    setScenes: any;
    descriptionAvailable: boolean;
    setDescriptionAvailable: any;
    title: string;
    setAudioObjects: any;
    audioDescriptionVolume: number;
    selectedLanguage: string;
}

export interface UploadDialogProps {
    videos: SavedVideoResult[];
    onVideoUploadCancelled: () => void;
    onVideoUploaded: (blobPrefix: string) => void
    onVideoTaskCreated: (taskInfo: VideoDetails) => void
    title: string;
    setTitle: any;
    selectedLanguage: string;
    setSelectedLanguage: any;
}

export interface ProcessVideoDialogProps {
    setOpenProcessDialog: any;
    videoDetails: VideoDetails
    setScenes: any;
    setAudioObjects: any;
    setDescriptionAvailable: any;
    setVideoUrl: any;
    scenes: Segment[];
    shouldContinueWithoutAsking: boolean;
    onVideoProcessed: (blobPrefix: string) => void;
    audioDescriptionVolume: number;
    selectedLanguage: string;
}

export interface VideoDetails {
    title: string;
    metadata: string;
    narrationStyle: string;
    videoUrl: string;
    taskId: string;
    analyzerId: string;
    selectedLanguage: string;
}

export interface SavedVideoResult {
    prefix: string;
    videoUrl: string;
    audioDescriptionJsonUrl: string;
    detailsJsonUrl: string;
}

export interface Segment {
    startTime: string;
    endTime: string;
    description: string;
}

export interface LanguageConfig {
    code: string;
    name: string;
    voiceName: string;
    xmlLang: string;
    speechRecognitionLanguage: string;
}

export const SUPPORTED_LANGUAGES: LanguageConfig[] = [
    {
        code: 'en-US',
        name: 'English (US)',
        voiceName: 'en-US-JennyNeural',
        xmlLang: 'en-US',
        speechRecognitionLanguage: 'en-US'
    },
    {
        code: 'ar-SA',
        name: 'Arabic (Saudi Arabia)',
        voiceName: 'ar-SA-ZariyahNeural',
        xmlLang: 'ar-SA',
        speechRecognitionLanguage: 'ar-SA'
    },
    {
        code: 'ar-EG',
        name: 'Arabic (Egypt)',
        voiceName: 'ar-EG-SalmaNeural',
        xmlLang: 'ar-EG',
        speechRecognitionLanguage: 'ar-EG'
    },
    {
        code: 'es-ES',
        name: 'Spanish (Spain)',
        voiceName: 'es-ES-ElviraNeural',
        xmlLang: 'es-ES',
        speechRecognitionLanguage: 'es-ES'
    },
    {
        code: 'fr-FR',
        name: 'French (France)',
        voiceName: 'fr-FR-DeniseNeural',
        xmlLang: 'fr-FR',
        speechRecognitionLanguage: 'fr-FR'
    }
];