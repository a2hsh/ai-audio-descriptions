import { ProcessVideoDialogProps, SUPPORTED_LANGUAGES } from "./Models";
import React, { useEffect } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogBody,
    DialogContent,
    DialogSurface,
    DialogTitle,
    Field,
    ProgressBar,
} from "@fluentui/react-components";
import { uploadToBlob } from "./helpers/BlobHelper";
import {
    generateAudioFiles,
    loadAudioFilesIntoMemory,
} from "./helpers/TtsHelper";
import {
    getAnalyzeTaskInProgress,
    getRewrittenSegmentsFromAnalyzerResult,
    createContentUnderstandingAnalyzer,
    createAnalyzeFileTask,
} from "./helpers/ContentUnderstandingHelper";

interface ReprocessFields {
    metadata: string;
    setMetadata: (val: string) => void;
    narrationStyle: string;
    setNarrationStyle: (val: string) => void;
    language: string;
    setLanguage: (val: string) => void;
}

type Props = ProcessVideoDialogProps & {
    reprocessFields?: ReprocessFields;
};

export const ProcessVideoDialog: React.FC<Props> = (props) => {
    const { title, taskId, analyzerId, videoUrl } = props.videoDetails;
    const reprocessFields: Partial<ReprocessFields> = React.useMemo(
        () => props.reprocessFields || {},
        [props.reprocessFields]
    );
    const [localMetadata, setLocalMetadata] = React.useState("");
    const [localNarrationStyle, setLocalNarrationStyle] = React.useState("");
    const [localLanguage, setLocalLanguage] = React.useState("en-US");
    const [showForm, setShowForm] = React.useState(true);
    const [videoProcessing, setVideoProcessing] = React.useState(false);
    const [rewritingDescriptions, setRewritingDescriptions] =
        React.useState(false);
    const [generatingAudio, setGeneratingAudio] = React.useState(false);
    const [loadingAudio, setLoadingAudio] = React.useState(false);
    const [numberOfAudioFilesGenerated, setNumberOfAudioFilesGenerated] =
        React.useState(0);
    const [processingError, setProcessingError] = React.useState("");
    // New: submenu state
    const [reprocessMode, setReprocessMode] = React.useState<
        "reanalyze" | "regenerate"
    >("reanalyze");

    React.useEffect(() => {
        setLocalMetadata(
            reprocessFields?.metadata && reprocessFields.metadata.trim() !== ""
                ? reprocessFields.metadata
                : props.videoDetails.metadata || ""
        );
        setLocalNarrationStyle(
            reprocessFields?.narrationStyle &&
                reprocessFields.narrationStyle.trim() !== ""
                ? reprocessFields.narrationStyle
                : props.videoDetails.narrationStyle || ""
        );
        setLocalLanguage(
            reprocessFields?.language && reprocessFields.language.trim() !== ""
                ? reprocessFields.language
                : props.videoDetails.selectedLanguage || "en-US"
        );
    }, [
        props.videoDetails,
        reprocessFields?.metadata,
        reprocessFields?.narrationStyle,
        reprocessFields?.language,
    ]);

    // Main handler for both modes
    const handleContinue = React.useCallback(async () => {
        console.log("handleContinue called with mode:", reprocessMode);
        setShowForm(false);
        if (reprocessMode === "reanalyze") {
            setVideoProcessing(true);
            if (reprocessFields?.setMetadata)
                reprocessFields.setMetadata(localMetadata);
            if (reprocessFields?.setNarrationStyle)
                reprocessFields.setNarrationStyle(localNarrationStyle);
            if (reprocessFields?.setLanguage)
                reprocessFields.setLanguage(localLanguage);
            let newAnalyzerId = "";
            let newTaskId = "";
            let operationLocation = "";
            try {
                const analyzer = await createContentUnderstandingAnalyzer(
                    title,
                    localMetadata,
                    localNarrationStyle,
                    localLanguage
                );
                newAnalyzerId = analyzer.analyzerId;
                const analyzeTask = await createAnalyzeFileTask(
                    newAnalyzerId,
                    videoUrl
                );
                newTaskId = analyzeTask.taskId;
                operationLocation = analyzeTask.operationLocation;
            } catch (e: any) {
                setProcessingError(
                    "Failed to create new analyzer or analyze task. " +
                        (typeof e === "object" && e && "message" in e
                            ? (e as any).message
                            : String(e))
                );
                setVideoProcessing(false);
                setShowForm(true);
                return;
            }
            if (!newTaskId || !newAnalyzerId || !operationLocation) {
                setProcessingError(
                    "Missing analyzer, task ID, or operation-location."
                );
                return;
            }
            setShowForm(false);
            setVideoProcessing(true);
            let status;
            try {
                status = await getAnalyzeTaskInProgress(operationLocation);
                while (
                    status.status === "Running" ||
                    status.status === "NotStarted"
                ) {
                    await new Promise((r) => setTimeout(r, 1500));
                    status = await getAnalyzeTaskInProgress(operationLocation);
                }
            } catch (e: any) {
                setProcessingError(
                    "Failed to poll analyze task. " +
                        (typeof e === "object" && e && "message" in e
                            ? (e as any).message
                            : String(e))
                );
                setVideoProcessing(false);
                setShowForm(true);
                return;
            }
            if (status.status !== "Succeeded") {
                setProcessingError(`Analyze failed: ${status.status}`);
                setVideoProcessing(false);
                setShowForm(true);
                return;
            }
            setVideoProcessing(false);
            setRewritingDescriptions(true);
            const audioDescriptions =
                await getRewrittenSegmentsFromAnalyzerResult(
                    status,
                    title,
                    localMetadata,
                    localNarrationStyle,
                    localLanguage
                );
            props.setScenes(audioDescriptions);
            await uploadToBlob(
                JSON.stringify(audioDescriptions),
                title,
                title + ".json",
                null
            );
            setGeneratingAudio(true);
            setRewritingDescriptions(false);
            await generateAudioFiles(
                audioDescriptions,
                title,
                setNumberOfAudioFilesGenerated,
                localLanguage
            );
            setGeneratingAudio(false);
            setLoadingAudio(true);
            props.setDescriptionAvailable(true);
            await loadAudioFilesIntoMemory(
                title,
                audioDescriptions,
                props.setAudioObjects,
                props.audioDescriptionVolume
            );
            setLoadingAudio(false);
            setVideoProcessing(false);
            setShowForm(true);
            setGeneratingAudio(false);
            setLoadingAudio(false);
            setRewritingDescriptions(false);
            setNumberOfAudioFilesGenerated(0);
            if (reprocessFields?.setMetadata)
                reprocessFields.setMetadata(localMetadata);
            if (reprocessFields?.setNarrationStyle)
                reprocessFields.setNarrationStyle(localNarrationStyle);
            if (reprocessFields?.setLanguage)
                reprocessFields.setLanguage(localLanguage);
            props.setVideoUrl(videoUrl);
            props.onVideoProcessed(title);
            props.setOpenProcessDialog(false);
        } else if (reprocessMode === "regenerate") {
            // Only regenerate descriptions based on current analysis (skip reanalyze)
            console.log("Starting regenerate mode with scenes:", props.scenes);
            
            if (!props.scenes || props.scenes.length === 0) {
                setProcessingError("No existing scenes found to regenerate descriptions. Please reanalyze the video first.");
                setShowForm(true);
                return;
            }
            
            setRewritingDescriptions(true);
            try {
                // Map props.scenes to include startTimeMs/endTimeMs for compatibility
                const segmentsWithMs = props.scenes.map((seg, idx) => {
                    // Convert time strings to milliseconds if needed
                    let startTimeMs: number;
                    let endTimeMs: number;
                    
                    if (typeof seg.startTime === "string") {
                        // Convert "HH:MM:SS.mmm" format to milliseconds
                        const parts = seg.startTime.split(':');
                        const hours = parseInt(parts[0]) || 0;
                        const minutes = parseInt(parts[1]) || 0;
                        const seconds = parseFloat(parts[2]) || 0;
                        startTimeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
                    } else {
                        startTimeMs = seg.startTime || (idx * 5000);
                    }
                    
                    if (typeof seg.endTime === "string") {
                        // Convert "HH:MM:SS.mmm" format to milliseconds
                        const parts = seg.endTime.split(':');
                        const hours = parseInt(parts[0]) || 0;
                        const minutes = parseInt(parts[1]) || 0;
                        const seconds = parseFloat(parts[2]) || 0;
                        endTimeMs = (hours * 3600 + minutes * 60 + seconds) * 1000;
                    } else {
                        endTimeMs = seg.endTime || ((idx + 1) * 5000);
                    }
                    
                    return {
                        ...seg,
                        startTimeMs,
                        endTimeMs,
                        segmentId: idx.toString(),
                    };
                });
                const fakeAnalyzerResult = {
                    id: "fake-id",
                    status: "Succeeded",
                    result: {
                        apiVersion: "2025-05-01-preview",
                        createdAt: new Date().toISOString(),
                        warnings: [],
                        ...props.videoDetails,
                        contents: [
                            {
                                ...props.videoDetails,
                                segments: segmentsWithMs,
                            },
                        ],
                    },
                } as any;
                console.log("Created fake analyzer result:", fakeAnalyzerResult);
                console.log("Calling getRewrittenSegmentsFromAnalyzerResult...");
                const audioDescriptions =
                    await getRewrittenSegmentsFromAnalyzerResult(
                        fakeAnalyzerResult,
                        title,
                        localMetadata,
                        localNarrationStyle,
                        localLanguage
                    );
                console.log("Got audio descriptions:", audioDescriptions);
                props.setScenes(audioDescriptions);
                await uploadToBlob(
                    JSON.stringify(audioDescriptions),
                    title,
                    title + ".json",
                    null
                );
                setGeneratingAudio(true);
                setRewritingDescriptions(false);
                await generateAudioFiles(
                    audioDescriptions,
                    title,
                    setNumberOfAudioFilesGenerated,
                    localLanguage
                );
                setGeneratingAudio(false);
                setLoadingAudio(true);
                props.setDescriptionAvailable(true);
                await loadAudioFilesIntoMemory(
                    title,
                    audioDescriptions,
                    props.setAudioObjects,
                    props.audioDescriptionVolume
                );
                setLoadingAudio(false);
                setShowForm(true);
                setGeneratingAudio(false);
                setLoadingAudio(false);
                setRewritingDescriptions(false);
                setNumberOfAudioFilesGenerated(0);
                if (reprocessFields?.setMetadata)
                    reprocessFields.setMetadata(localMetadata);
                if (reprocessFields?.setNarrationStyle)
                    reprocessFields.setNarrationStyle(localNarrationStyle);
                if (reprocessFields?.setLanguage)
                    reprocessFields.setLanguage(localLanguage);
                props.setVideoUrl(videoUrl);
                props.onVideoProcessed(title);
                props.setOpenProcessDialog(false);
            } catch (e: any) {
                console.error("Error in regenerate mode:", e);
                setProcessingError(
                    "Failed to regenerate descriptions. " +
                        (typeof e === "object" && e && "message" in e
                            ? (e as any).message
                            : String(e))
                );
                setRewritingDescriptions(false);
                setShowForm(true);
            }
        }
    }, [
        setShowForm,
        setVideoProcessing,
        setRewritingDescriptions,
        setGeneratingAudio,
        setLoadingAudio,
        setNumberOfAudioFilesGenerated,
        setProcessingError,
        props,
        title,
        videoUrl,
        localMetadata,
        localNarrationStyle,
        localLanguage,
        reprocessFields,
        reprocessMode,
    ]);

    useEffect(() => {
        if (props.shouldContinueWithoutAsking) {
            handleContinue();
        }
    }, [props.shouldContinueWithoutAsking, handleContinue]);

    return (
        <Dialog open={true} modalType="modal">
            <DialogSurface>
                {showForm && (
                    <DialogBody>
                        <DialogTitle>Reprocess Audio Descriptions</DialogTitle>
                        <DialogContent>
                            <Field label="Reprocessing Mode" required>
                                <select
                                    style={{ width: "100%" }}
                                    value={reprocessMode}
                                    aria-label="Reprocessing mode"
                                    id="reprocess-mode-select"
                                    onChange={(e) =>
                                        setReprocessMode(
                                            e.target.value as
                                                | "reanalyze"
                                                | "regenerate"
                                        )
                                    }
                                >
                                    <option value="reanalyze">
                                        Reanalyze video and regenerate
                                        descriptions
                                    </option>
                                    <option value="regenerate">
                                        Regenerate descriptions only (use
                                        current analysis)
                                    </option>
                                </select>
                            </Field>
                            <Field label="Context / Metadata" required>
                                <textarea
                                    style={{ width: "100%", minHeight: 40 }}
                                    value={localMetadata}
                                    aria-label="Context or metadata for the video (required)"
                                    id="reprocess-metadata-input"
                                    onChange={(e) => {
                                        setLocalMetadata(e.target.value);
                                        if (reprocessFields?.setMetadata)
                                            reprocessFields.setMetadata(
                                                e.target.value
                                            );
                                    }}
                                />
                            </Field>
                            <Field label="Narration Style" required>
                                <input
                                    style={{ width: "100%" }}
                                    value={localNarrationStyle}
                                    aria-label="Narration style for audio description (required)"
                                    id="reprocess-narration-style-input"
                                    onChange={(e) => {
                                        setLocalNarrationStyle(e.target.value);
                                        if (reprocessFields?.setNarrationStyle)
                                            reprocessFields.setNarrationStyle(
                                                e.target.value
                                            );
                                    }}
                                />
                            </Field>
                            <Field label="Language" required>
                                <select
                                    style={{ width: "100%" }}
                                    value={localLanguage}
                                    aria-label="Language for audio description (required)"
                                    id="reprocess-language-select"
                                    onChange={(e) => {
                                        setLocalLanguage(e.target.value);
                                        if (reprocessFields?.setLanguage)
                                            reprocessFields.setLanguage(
                                                e.target.value
                                            );
                                    }}
                                >
                                    {SUPPORTED_LANGUAGES.map((lang) => (
                                        <option
                                            key={lang.code}
                                            value={lang.code}
                                        >
                                            {lang.name}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() =>
                                    props.setOpenProcessDialog(false)
                                }
                            >
                                Cancel
                            </Button>
                            <Button
                                type="button"
                                appearance="primary"
                                onClick={() => {
                                    console.log("Continue button clicked!");
                                    handleContinue();
                                }}
                            >
                                Continue
                            </Button>
                        </DialogActions>
                    </DialogBody>
                )}
                {videoProcessing && (
                    <DialogBody>
                        <DialogTitle tabIndex={0}>Processing Video</DialogTitle>
                        <DialogContent tabIndex={0}>
                            <ProgressBar title="This can take several minutes depending on the length of the video" />
                            {processingError && (
                                <p style={{ color: "red" }}>
                                    {processingError}
                                </p>
                            )}
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() =>
                                    props.setOpenProcessDialog(false)
                                }
                            >
                                Cancel
                            </Button>
                        </DialogActions>
                    </DialogBody>
                )}
                {rewritingDescriptions && (
                    <DialogBody>
                        <DialogTitle>
                            Rewriting descriptions to fit silent intervals
                        </DialogTitle>
                        <DialogContent>
                            <ProgressBar />
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() =>
                                    props.setOpenProcessDialog(false)
                                }
                            >
                                Cancel
                            </Button>
                        </DialogActions>
                    </DialogBody>
                )}
                {generatingAudio && (
                    <DialogBody>
                        <DialogTitle>Generating audio</DialogTitle>
                        <DialogContent>
                            <Field
                                validationMessage={`Audio files generated:  ${numberOfAudioFilesGenerated} of ${props.scenes.length}`}
                                validationState="none"
                            >
                                <ProgressBar
                                    max={props.scenes.length}
                                    value={numberOfAudioFilesGenerated}
                                />
                            </Field>
                        </DialogContent>
                        <DialogActions>
                            <Button
                                appearance="secondary"
                                onClick={() =>
                                    props.setOpenProcessDialog(false)
                                }
                            >
                                Cancel
                            </Button>
                        </DialogActions>
                    </DialogBody>
                )}
                {loadingAudio && (
                    <DialogBody>
                        <DialogTitle>Preparing video player...</DialogTitle>
                        <DialogContent>
                            <ProgressBar />
                        </DialogContent>
                    </DialogBody>
                )}
            </DialogSurface>
        </Dialog>
    );
};
