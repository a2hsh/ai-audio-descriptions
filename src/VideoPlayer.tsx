import React, { useEffect } from "react";
import ReactPlayer from "react-player";
import { SavedVideoResult, Segment, VideoDetails, VideoPlayerProps } from "./Models";
import { OnProgressProps } from "react-player/base";
import axios from "axios";
import { timeToSeconds } from "./helpers/Helper";
import { UploadVideoDialog } from "./UploadVideoDialog";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";
import { loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import { ProcessVideoDialog } from "./ProcessVideoDialog";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { blobSasToken, blobUri, STORAGE_CONTAINER_NAME } from "./keys";
import { deleteBlobWithPrefix, getUploadedVideos } from "./helpers/BlobHelper";
import DeleteVideoDialog from "./DeleteVideoDialog";

export const VideoPlayer: React.FC<VideoPlayerProps> = (props: VideoPlayerProps) => {
    const [openUploadDialog, setOpenUploadDialog] = React.useState(false);
    const [openProcessVideoDialog, setOpenProcessVideoDialog] = React.useState(false);
    const [currentDescription, setCurrentDescription] = React.useState('');
    const playPauseString = 'Play/Pause';
    const [videoPlayerReady, setVideoPlayerReady] = React.useState(false);
    const [currentAudio, setCurrentAudio] = React.useState<HTMLAudioElement>();
    const [isAudioOrVideoPlaying, setIsAudioOrVideoPlaying] = React.useState<boolean>();
    const [videoUploaded, setVideoUploaded] = React.useState(false);
    const [taskId, setTaskId] = React.useState<string>("");
    const [analyzerId, setAnalyzerId] = React.useState<string>("");
    const [metadata, setMetadata] = React.useState("");
    const [narrationStyle, setNarrationStyle] = React.useState("");
    const [reprocessMetadata, setReprocessMetadata] = React.useState("");
    const [reprocessNarrationStyle, setReprocessNarrationStyle] = React.useState("");
    const [reprocessLanguage, setReprocessLanguage] = React.useState("");
    const [videoUrl, setVideoUrl] = React.useState("");
    const [isPreparingForDownload, setIsPreparingForDownload] = React.useState(false);
    const [selectedVideo, setSelectedVideo] = React.useState<SavedVideoResult>();
    const [videos, setVideos] = React.useState<SavedVideoResult[]>([]);

    const ffmpeg = new FFmpeg();

    const resetState = () => {
        props.setScenes([]);
        props.setAudioObjects([]);
        props.setVideoPlaying(false);
        props.setDescriptionAvailable(false);
        props.setLastReadTime(-1);
        setVideoUrl('');
        setIsAudioOrVideoPlaying(false);
        setVideoPlayerReady(false);
        setCurrentDescription('');
        setIsPreparingForDownload(false);
        setSelectedVideo(undefined);
    }

    useEffect(() => {
        resetState();
        setVideos(props.allVideos);
    }, [props.allVideos]
    );

    const handlePlayClick = () => {
        props.setVideoPlaying(true);
        setIsAudioOrVideoPlaying(true);
    }

    const handlePauseClick = () => {
        props.setVideoPlaying(false);
        setIsAudioOrVideoPlaying(false);
        currentAudio?.pause();
    }

    const playPauseHandler = isAudioOrVideoPlaying ? handlePauseClick : handlePlayClick;

    const playerRef = React.useRef<ReactPlayer>(null);

    const handleStopClick = () => {
        if (playerRef.current) {
            playerRef.current.seekTo(0);
            handlePauseClick();
            props.setLastReadTime(-1);
            setCurrentDescription('');
        }
    };

    const handleOnReady = () => {
        setVideoPlayerReady(true);
        // Apply initial video volume when player is ready
        if (playerRef.current) {
            const internalPlayer = playerRef.current.getInternalPlayer();
            if (internalPlayer && typeof internalPlayer.volume !== 'undefined') {
                internalPlayer.volume = props.originalVideoVolume;
            }
        }
    }

    const handleVideoVolumeChange = (newVolume: number) => {
        props.setOriginalVideoVolume(newVolume);
        if (playerRef.current) {
            const internalPlayer = playerRef.current.getInternalPlayer();
            if (internalPlayer && typeof internalPlayer.volume !== 'undefined') {
                internalPlayer.volume = newVolume;
            }
        }
    }

    const handleAudioDescriptionVolumeChange = (newVolume: number) => {
        props.setAudioDescriptionVolume(newVolume);
        // Update volume for all audio objects
        props.audioObjects.forEach(audio => {
            audio.volume = newVolume;
        });
        // Update current playing audio if any
        if (currentAudio) {
            currentAudio.volume = newVolume;
        }
    }

    const fadeAudio = (audioElement: HTMLAudioElement, fromVolume: number, toVolume: number, duration: number) => {
        const steps = 50; // Number of fade steps
        const stepDuration = duration * 1000 / steps; // Duration per step in ms
        const volumeStep = (toVolume - fromVolume) / steps;
        let currentStep = 0;

        const fadeInterval = setInterval(() => {
            currentStep++;
            const newVolume = fromVolume + (volumeStep * currentStep);
            audioElement.volume = Math.max(0, Math.min(1, newVolume));

            if (currentStep >= steps) {
                clearInterval(fadeInterval);
                audioElement.volume = toVolume;
            }
        }, stepDuration);

        return fadeInterval;
    }

    const fadeVideoVolume = (fromVolume: number, toVolume: number, duration: number) => {
        const steps = 50;
        const stepDuration = duration * 1000 / steps;
        const volumeStep = (toVolume - fromVolume) / steps;
        let currentStep = 0;

        const fadeInterval = setInterval(() => {
            currentStep++;
            const newVolume = fromVolume + (volumeStep * currentStep);
            
            // Apply to ReactPlayer's internal video element
            if (playerRef.current) {
                const internalPlayer = playerRef.current.getInternalPlayer();
                if (internalPlayer && typeof internalPlayer.volume !== 'undefined') {
                    internalPlayer.volume = Math.max(0, Math.min(1, newVolume));
                }
            }

            if (currentStep >= steps) {
                clearInterval(fadeInterval);
                if (playerRef.current) {
                    const internalPlayer = playerRef.current.getInternalPlayer();
                    if (internalPlayer && typeof internalPlayer.volume !== 'undefined') {
                        internalPlayer.volume = toVolume;
                    }
                }
            }
        }, stepDuration);

        return fadeInterval;
    }

    const loadVideoFromList = async (selectedVideo: SavedVideoResult) => {
        if (selectedVideo.videoUrl === videoUrl) {
            return;
        }
        resetState();
        const title = selectedVideo.videoUrl.split('?')[0].split('/')[selectedVideo.videoUrl.split('?')[0].split('/').length - 1].split('.')[0];
        props.setTitle(title);
        setVideoUrl(selectedVideo.videoUrl);
        setSelectedVideo(selectedVideo);
        
        // Always try to load video details for potential reprocessing
        if (selectedVideo.detailsJsonUrl !== '') {
            try {
                const videoDetails: VideoDetails = (await axios.get(selectedVideo.detailsJsonUrl)).data;
                console.log("Loaded video details:", videoDetails);
                setTaskId(videoDetails.taskId);
                setAnalyzerId(videoDetails.analyzerId);
                setMetadata(videoDetails.metadata);
                setNarrationStyle(videoDetails.narrationStyle);
                // Set the language from the saved video details, or default to current selection
                if (videoDetails.selectedLanguage) {
                    console.log("Setting language from video details:", videoDetails.selectedLanguage);
                    props.setSelectedLanguage(videoDetails.selectedLanguage);
                }
            } catch (error) {
                console.warn("Could not load video details:", error);
            }
        }
        
        if (selectedVideo.audioDescriptionJsonUrl !== '') {
            setVideoUrl(selectedVideo.videoUrl);
            const jsonResult = await axios.get(selectedVideo.audioDescriptionJsonUrl);
            const audioDescriptions: any = jsonResult.data;
            props.setScenes(audioDescriptions);
            props.setDescriptionAvailable(true);
            await loadAudioFilesIntoMemory(title, audioDescriptions, props.setAudioObjects, props.audioDescriptionVolume);
        }
        else {
            // No existing descriptions, trigger processing
            setOpenUploadDialog(false);
            setVideoUploaded(false);
            setOpenProcessVideoDialog(true);
        }
    }

    const handleReprocess = () => {
        if (selectedVideo && taskId && analyzerId) {
            setReprocessMetadata(metadata);
            setReprocessNarrationStyle(narrationStyle);
            setReprocessLanguage(props.selectedLanguage);
            setVideoUploaded(false); // Don't auto-continue, ask user for confirmation
            setOpenProcessVideoDialog(true);
        } else {
            alert("Cannot reprocess: Missing video details. The video may need to be re-uploaded.");
        }
    }

    const download = async () => {
        setIsPreparingForDownload(true);
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        const ffmpegParams = [];
        await ffmpeg.writeFile('video.mp4', await fetchFile(videoUrl));
        ffmpegParams.push("-i", "video.mp4");

        const fetchFilePromises = props.scenes.map((_, i) => fetchFile(`${blobUri}/${STORAGE_CONTAINER_NAME}/${props.title}/${props.title}_${i}.wav?${blobSasToken}`));
        const fetchedFiles = await Promise.all(fetchFilePromises);
        const ffmpegWriteAudioPromises = props.scenes.map((_, i) => {
            ffmpegParams.push("-i", `audio_${i}.wav`);
            return ffmpeg.writeFile(`audio_${i}.wav`, fetchedFiles[i])
        });
        await Promise.all(ffmpegWriteAudioPromises);

        let filterComplexPart1 = "";
        let filterComplexPart2 = "";
        
        // Create audio description tracks with proper timing
        props.scenes.forEach((scene, i) => {
            const delayMs = timeToSeconds(scene.startTime) * 1000;
            filterComplexPart1 += `[${i + 1}]volume=${props.audioDescriptionVolume},adelay=${delayMs}|${delayMs}[a${i}];`;
        });
        
        // Apply ducking - keep it simple and reliable
        if (props.duckingEnabled && props.scenes.length > 0) {
            // Just use a simple constant duck level during description periods
            // This is the approach that actually works reliably in FFmpeg
            filterComplexPart1 += `[0:a]volume=${props.originalVideoVolume}`;
            
            // Apply simple volume reduction for each scene
            props.scenes.forEach(scene => {
                const startTime = timeToSeconds(scene.startTime);
                const endTime = timeToSeconds(scene.endTime);
                filterComplexPart1 += `,volume=enable='between(t,${startTime},${endTime})':volume=${props.originalVideoVolume * 0.2}`;
            });
            
            filterComplexPart1 += "[ducked_audio];";
            filterComplexPart2 = "[ducked_audio]";
        } else {
            // No ducking - simple volume control
            filterComplexPart1 += `[0:a]volume=${props.originalVideoVolume}[original_audio];`;
            filterComplexPart2 = "[original_audio]";
        }
        
        // Mix with audio descriptions using proper volume normalization
        props.scenes.forEach((_, i) => {
            filterComplexPart2 += `[a${i}]`;
        });
        // Use amix without weights to prevent volume reduction
        filterComplexPart2 += `amix=inputs=${props.scenes.length + 1}:normalize=0`;

        ffmpegParams.push("-filter_complex", filterComplexPart1 + filterComplexPart2);
        ffmpegParams.push("-c:v", "copy", `output.mp4`);
        await ffmpeg.exec(ffmpegParams);

        try {
            const data = await ffmpeg.readFile('output.mp4');
            const link = document.createElement("a");
            link.href = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
            link.download = props.title + "_output.mp4"
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        catch (e) {
            console.log(e);
        }
        finally {
            setIsPreparingForDownload(false);
        }
    }

    const readDescription = async (scenes: Segment[]) => {
        const currentTime = playerRef.current!.getCurrentTime();
        console.log(`readDescription called - currentTime: ${currentTime}, scenes: ${scenes.length}, audioObjects: ${props.audioObjects.length}`);
        console.log(`audioObjects array:`, props.audioObjects);
        
        if (scenes.length > 0) {
            for (let i = 0; i < scenes.length; i++) {
                const startTime = timeToSeconds(scenes[i].startTime);
                const endTime = timeToSeconds(scenes[i].endTime);
                if (currentTime >= startTime && currentTime <= endTime) {
                    const scene = scenes[i];
                    setCurrentDescription(scene.description);
                    if (props.descriptionAvailable) {
                        const audioElement = props.audioObjects[i];
                        console.log(`Playing audio description ${i}, audio element:`, audioElement);
                        console.log(`Audio element src:`, audioElement?.src);
                        console.log(`Audio element readyState:`, audioElement?.readyState);
                        
                        if (!audioElement) {
                            console.error(`Audio element ${i} is undefined or null`);
                            return;
                        }
                        
                        // Step 1: Fade out video audio (ducking) ONLY if enabled
                        if (props.duckingEnabled) {
                            fadeVideoVolume(props.originalVideoVolume, props.originalVideoVolume * 0.2, props.fadeInDuration);
                        }
                        // Step 2: Start audio description at normal volume
                        audioElement.volume = props.audioDescriptionVolume;
                        
                        // Try to play and handle any errors
                        const playPromise = audioElement.play();
                        if (playPromise !== undefined) {
                            playPromise.then(() => {
                                console.log(`Successfully started playing audio description ${i}`);
                                setIsAudioOrVideoPlaying(true);
                                setCurrentAudio(audioElement);
                            }).catch(error => {
                                console.error(`Failed to play audio description ${i}:`, error);
                                console.error(`Audio element details:`, {
                                    src: audioElement.src,
                                    readyState: audioElement.readyState,
                                    networkState: audioElement.networkState,
                                    error: audioElement.error
                                });
                            });
                        } else {
                            // Fallback for older browsers
                            setIsAudioOrVideoPlaying(true);
                            setCurrentAudio(audioElement);
                        }

                        // Helper: Should we unduck after this segment?
                        const shouldUnduck = () => {
                            // If this is the last segment, always unduck
                            if (i === scenes.length - 1) return true;
                            const thisEnd = timeToSeconds(scenes[i].endTime);
                            const nextStart = timeToSeconds(scenes[i + 1].startTime);
                            const gap = nextStart - thisEnd;
                            // Use fadeOut + fadeIn as the threshold
                            const threshold = props.fadeOutDuration + props.fadeInDuration;
                            return gap >= threshold;
                        };

                        // Step 3: When audio description ends, fade video back up only if needed and ducking is enabled
                        audioElement.addEventListener('ended', () => {
                            if (props.duckingEnabled && shouldUnduck()) {
                                fadeVideoVolume(props.originalVideoVolume * 0.2, props.originalVideoVolume, props.fadeOutDuration);
                            } else if (!props.duckingEnabled) {
                                // No unduck needed, leave volume as is
                            } else {
                                // Keep ducked, next segment is very close
                                console.log('Skipping unduck: next audio description is very close.');
                            }
                        }, { once: true });

                        // Step 4: Handle manual stopping (if video is paused/stopped)
                        audioElement.addEventListener('pause', () => {
                            if (props.duckingEnabled && shouldUnduck()) {
                                fadeVideoVolume(props.originalVideoVolume * 0.2, props.originalVideoVolume, props.fadeOutDuration);
                            } else if (!props.duckingEnabled) {
                                // No unduck needed, leave volume as is
                            } else {
                                console.log('Skipping unduck on pause: next audio description is very close.');
                            }
                        }, { once: true });
                    }
                    console.log(scene.description);
                }
            }
        }
    }

    const displayWidth = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
    const playerWidth = displayWidth > 1000 ? '640px' : '90vw';
    const playerHeight = displayWidth > 1000 ? '360px' : '70vw';

    const onProgress = (state: OnProgressProps) => {
        if (!props.videoPlaying) {
            return;
        }
        const currentTime = state.playedSeconds;
        let descriptionTime = 0;
        for (let i = 0; i < props.scenes.length; i++) {
            const startTime = timeToSeconds(props.scenes[i].startTime);
            const endTime = timeToSeconds(props.scenes[i].endTime);
            if (currentTime >= startTime && currentTime <= endTime) {
                descriptionTime = startTime;
            }
        }
        if (descriptionTime - props.lastReadTime > 0.1) {
            props.setLastReadTime(descriptionTime);
            readDescription(props.scenes);
        }
    }

    const deleteVideo = async (blobPrefix: string) => {
        resetState();
        await deleteBlobWithPrefix(blobPrefix);
        props.onVideoDeleted();
    }

    const onVideoUploadCancelled = () => {
        setOpenUploadDialog(false);
    }

    const onVideoUploaded = async (blobPrefix: string) => {
        const videoData = await getUploadedVideos({ prefix: blobPrefix });
        if (videoData.length === 1) {
            const newVideos = [...videos];
            const existingVideoIndex = newVideos.findIndex(video => video.prefix === blobPrefix);
            if (existingVideoIndex !== -1) {
                newVideos[existingVideoIndex] = videoData[0];
            } else {
                newVideos.push(videoData[0]);
            }
            setVideos(newVideos);
            setSelectedVideo(videoData[0]);
        }
    }

    const onVideoTaskCreated = (
        taskInfo: VideoDetails) => {
        setTaskId(taskInfo.taskId);
        setAnalyzerId(taskInfo.analyzerId);
        setVideoUrl(taskInfo.videoUrl);
        setMetadata(taskInfo.metadata);
        setNarrationStyle(taskInfo.narrationStyle);
        setOpenUploadDialog(false);
        setVideoUploaded(true);
        setOpenProcessVideoDialog(true);
    }

    return (
        <>
            {openUploadDialog &&
                <UploadVideoDialog
                    videos={videos}
                    onVideoUploadCancelled={onVideoUploadCancelled}
                    onVideoUploaded={onVideoUploaded}
                    onVideoTaskCreated={onVideoTaskCreated}
                    title={props.title}
                    setTitle={props.setTitle}
                    selectedLanguage={props.selectedLanguage}
                    setSelectedLanguage={props.setSelectedLanguage} />}
            {openProcessVideoDialog && <ProcessVideoDialog
                videoDetails={{
                    title: props.title,
                    metadata: reprocessMetadata,
                    narrationStyle: reprocessNarrationStyle,
                    taskId: taskId,
                    analyzerId: analyzerId,
                    videoUrl: videoUrl,
                    selectedLanguage: reprocessLanguage
                }}
                setScenes={props.setScenes}
                setAudioObjects={props.setAudioObjects}
                setDescriptionAvailable={props.setDescriptionAvailable}
                setVideoUrl={setVideoUrl}
                onVideoProcessed={onVideoUploaded}
                setOpenProcessDialog={setOpenProcessVideoDialog}
                scenes={props.scenes}
                shouldContinueWithoutAsking={videoUploaded}
                audioDescriptionVolume={props.audioDescriptionVolume}
                selectedLanguage={reprocessLanguage}
                reprocessFields={{
                    metadata: reprocessMetadata,
                    setMetadata: setReprocessMetadata,
                    narrationStyle: reprocessNarrationStyle,
                    setNarrationStyle: setReprocessNarrationStyle,
                    language: reprocessLanguage,
                    setLanguage: setReprocessLanguage
                }}
            />}
            <Dialog open={isPreparingForDownload} modalType="modal">
                <DialogSurface>
                    <DialogBody>
                        <DialogTitle>Downloading...</DialogTitle>
                        <DialogContent>
                            <div style={{ 'marginTop': '20px' }}>
                                <ProgressBar />
                            </div>
                        </DialogContent>
                    </DialogBody>
                </DialogSurface>
            </Dialog>
            <h2>Upload a new video</h2>
            <Button appearance="primary" onClick={() => setOpenUploadDialog(true)}>Upload</Button>
            <div>
                <h2>Select a video from the list</h2>
                {props.videoListLoading
                    ? <div style={{ maxWidth: '20vw' }}><Field validationMessage={"Loading..."} validationState="none"><ProgressBar /></Field></div>
                    : videos.length === 0 ? <p>No videos available.</p> : <ul>
                        {videos.map((video, i) => {
                            return <li key={i}>
                                <button className="button-link" onClick={() => loadVideoFromList(video)}>{video.prefix}</button>
                            </li>
                        }
                        )}
                    </ul>}
            </div>
            <div className='video-player'>
                <h2>Video Player</h2>
                <div className='player-button-group'>
                    <div className='player-button'>
                        <Button appearance="primary" onClick={playPauseHandler} disabled={!videoPlayerReady}>{playPauseString}</Button>
                    </div>
                    <div className='player-button'>
                        <Button appearance="primary" onClick={download} disabled={props.scenes.length <= 0}>Download</Button>
                    </div>
                    {selectedVideo && taskId && analyzerId && (
                        <div className='player-button'>
                            <Button appearance="secondary" onClick={handleReprocess} disabled={!selectedVideo}>Reprocess</Button>
                        </div>
                    )}
                    <div className='player-button'>
                        <label htmlFor="video-volume">Video Volume: {Math.round(props.originalVideoVolume * 100)}%</label>
                        <input 
                            id="video-volume"
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.1" 
                            value={props.originalVideoVolume}
                            onChange={(e) => handleVideoVolumeChange(parseFloat(e.target.value))}
                            style={{ marginLeft: '10px', width: '100px' }}
                        />
                    </div>
                    <div className='player-button'>
                        <label htmlFor="ad-volume">Audio Description Volume: {Math.round(props.audioDescriptionVolume * 100)}%</label>
                        <input 
                            id="ad-volume"
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.1" 
                            value={props.audioDescriptionVolume}
                            onChange={(e) => handleAudioDescriptionVolumeChange(parseFloat(e.target.value))}
                            style={{ marginLeft: '10px', width: '100px' }}
                        />
                    </div>
                    <div className='player-button'>
                        <label htmlFor="fade-in">Fade In: {props.fadeInDuration}s</label>
                        <input 
                            id="fade-in"
                            type="range" 
                            min="0" 
                            max="2" 
                            step="0.1" 
                            value={props.fadeInDuration}
                            onChange={(e) => props.setFadeInDuration(parseFloat(e.target.value))}
                            style={{ marginLeft: '10px', width: '100px' }}
                        />
                    </div>
                    <div className='player-button'>
                        <label htmlFor="fade-out">Fade Out: {props.fadeOutDuration}s</label>
                        <input 
                            id="fade-out"
                            type="range" 
                            min="0" 
                            max="2" 
                            step="0.1" 
                            value={props.fadeOutDuration}
                            onChange={(e) => props.setFadeOutDuration(parseFloat(e.target.value))}
                            style={{ marginLeft: '10px', width: '100px' }}
                        />
                    </div>
                    <div className='player-button'>
                        <label>
                            <input 
                                type="checkbox" 
                                checked={props.duckingEnabled}
                                onChange={(e) => props.setDuckingEnabled(e.target.checked)}
                                style={{ marginRight: '8px' }}
                            />
                            Enable Ducking (Download)
                        </label>
                    </div>
                    {selectedVideo &&
                        <div>
                            <DeleteVideoDialog video={selectedVideo} onVideoDelete={deleteVideo} />
                        </div>}
                </div>
                <ReactPlayer width={playerWidth} height={playerHeight} onProgress={onProgress} ref={playerRef} url={videoUrl} playing={props.videoPlaying} onEnded={handleStopClick} onReady={handleOnReady} />
                <p>{currentDescription}</p>
            </div>
        </>
    );
};