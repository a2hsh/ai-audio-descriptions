import { ProcessVideoDialogProps, SUPPORTED_LANGUAGES } from "./Models";
import React, { useEffect } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, ProgressBar } from "@fluentui/react-components";
import { uploadToBlob } from "./helpers/BlobHelper";
import { generateAudioFiles, loadAudioFilesIntoMemory } from "./helpers/TtsHelper";
import { getAnalyzeTaskInProgress, getAudioDescriptionsFromAnalyzeResult, createContentUnderstandingAnalyzer, createAnalyzeFileTask } from "./helpers/ContentUnderstandingHelper";

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
    // For reprocessing, allow editing context, narration style, and language
    const reprocessFields: Partial<ReprocessFields> = props.reprocessFields || {};
    // Always prefer videoDetails as the source of truth for initial values
    const [localMetadata, setLocalMetadata] = React.useState(
        (reprocessFields?.metadata && reprocessFields.metadata.trim() !== "")
            ? reprocessFields.metadata
            : (props.videoDetails.metadata || "")
    );
    const [localNarrationStyle, setLocalNarrationStyle] = React.useState(
        (reprocessFields?.narrationStyle && reprocessFields.narrationStyle.trim() !== "")
            ? reprocessFields.narrationStyle
            : (props.videoDetails.narrationStyle || "")
    );
    const [localLanguage, setLocalLanguage] = React.useState(
        (reprocessFields?.language && reprocessFields.language.trim() !== "")
            ? reprocessFields.language
            : (props.videoDetails.selectedLanguage || "en-US")
    );
    const [showForm, setShowForm] = React.useState(true);
    const [videoProcessing, setVideoProcessing] = React.useState(false);
    const [rewritingDescriptions, setRewritingDescriptions] = React.useState(false);
    const [generatingAudio, setGeneratingAudio] = React.useState(false);
    const [loadingAudio, setLoadingAudio] = React.useState(false);
    const [numberOfAudioFilesGenerated, setNumberOfAudioFilesGenerated] = React.useState(0);
    const [processingError, setProcessingError] = React.useState("");

    // moved inside handleContinue

    const handleContinue = React.useCallback(async () => {
        let newAnalyzerId = analyzerId;
        let newTaskId = taskId;
        // Check if context, narration style, or language changed from original
        if (
            localMetadata !== (props.videoDetails.metadata ?? "") ||
            localNarrationStyle !== (props.videoDetails.narrationStyle ?? "") ||
            localLanguage !== (props.videoDetails.selectedLanguage ?? "en-US")
        ) {
            setShowForm(false);
            setVideoProcessing(true);
            try {
                const analyzer = await createContentUnderstandingAnalyzer(title, localMetadata, localNarrationStyle, localLanguage);
                newAnalyzerId = analyzer.analyzerId;
                const analyzeTask = await createAnalyzeFileTask(newAnalyzerId, videoUrl);
                newTaskId = analyzeTask.id;
            } catch (e: any) {
                setProcessingError("Failed to create new analyzer or analyze task. " + (typeof e === 'object' && e && 'message' in e ? (e as any).message : String(e)));
                setVideoProcessing(false);
                setShowForm(true);
                return;
            }
        }
        if (!newTaskId || !newAnalyzerId) {
            setProcessingError("Missing analyzer or task ID.");
            return;
        }
        setShowForm(false);
        setVideoProcessing(true);
        while (true) {
            const task = await getAnalyzeTaskInProgress(newAnalyzerId, newTaskId);
            if (task.status?.toLowerCase() === "succeeded") {
                setVideoProcessing(false);
                setRewritingDescriptions(true);
                const audioDescriptions = await getAudioDescriptionsFromAnalyzeResult(
                    task.result.contents,
                    title,
                    localMetadata,
                    localNarrationStyle,
                    localLanguage
                );
                props.setScenes(audioDescriptions);
                await uploadToBlob(JSON.stringify(audioDescriptions), title, title + ".json", null);
                setGeneratingAudio(true);
                setRewritingDescriptions(false);
                await generateAudioFiles(audioDescriptions, title, setNumberOfAudioFilesGenerated, localLanguage);
                setGeneratingAudio(false);
                setLoadingAudio(true);
                props.setDescriptionAvailable(true);
                await loadAudioFilesIntoMemory(title, audioDescriptions, props.setAudioObjects, props.audioDescriptionVolume);
                setLoadingAudio(false);
                break;
            }
            const errorTask = task as any;
            if (errorTask.error) {
                const message = errorTask.error?.message || "An error occurred while processing the video";
                setProcessingError(message);
                break;
            }
            await new Promise(r => setTimeout(r, 15000));
            setProcessingError("");
        }
        // resetFormState inline
        setVideoProcessing(false);
        setShowForm(true);
        setGeneratingAudio(false);
        setLoadingAudio(false);
        setRewritingDescriptions(false);
        setNumberOfAudioFilesGenerated(0);
        props.setVideoUrl(videoUrl);
        props.onVideoProcessed(title);
        props.setOpenProcessDialog(false);
    }, [taskId, analyzerId, setShowForm, setVideoProcessing, setRewritingDescriptions, setGeneratingAudio, setLoadingAudio, setNumberOfAudioFilesGenerated, setProcessingError, props, title, videoUrl, localMetadata, localNarrationStyle, localLanguage]);

    useEffect(() => {
        if (props.shouldContinueWithoutAsking) {
            handleContinue();
        }
    }, [props.shouldContinueWithoutAsking, handleContinue]);

    return <>
    <Dialog open={true} modalType="modal">
        <DialogSurface>
            { showForm && <DialogBody>
                <DialogTitle>Reprocess Audio Descriptions</DialogTitle>
                <DialogContent>
                    <Field label="Context / Metadata" required>
                        <textarea
                            style={{ width: '100%', minHeight: 40 }}
                            value={localMetadata}
                            aria-label="Context or metadata for the video (required)"
                            id="reprocess-metadata-input"
                            onChange={e => {
                                setLocalMetadata(e.target.value);
                                if (reprocessFields?.setMetadata) reprocessFields.setMetadata(e.target.value);
                            }}
                        />
                    </Field>
                    <Field label="Narration Style" required>
                        <input
                            style={{ width: '100%' }}
                            value={localNarrationStyle}
                            aria-label="Narration style for audio description (required)"
                            id="reprocess-narration-style-input"
                            onChange={e => {
                                setLocalNarrationStyle(e.target.value);
                                if (reprocessFields?.setNarrationStyle) reprocessFields.setNarrationStyle(e.target.value);
                            }}
                        />
                    </Field>
                    <Field label="Language" required>
                        <select
                            style={{ width: '100%' }}
                            value={localLanguage}
                            aria-label="Language for audio description (required)"
                            id="reprocess-language-select"
                            onChange={e => {
                                setLocalLanguage(e.target.value);
                                if (reprocessFields?.setLanguage) reprocessFields.setLanguage(e.target.value);
                            }}
                        >
                            {SUPPORTED_LANGUAGES.map(lang => (
                                <option key={lang.code} value={lang.code}>{lang.name}</option>
                            ))}
                        </select>
                    </Field>
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                    <Button type="submit" appearance="primary" onClick={handleContinue}>Reprocess</Button>
                </DialogActions>
            </DialogBody>}
            {videoProcessing && <DialogBody>
                <DialogTitle tabIndex={0}>Processing Video</DialogTitle>
                <DialogContent tabIndex={0}>
                    {<ProgressBar title="This can take several minutes depending on the length of the video" />}
                    {processingError && <p style={{color: "red"}}>{processingError}</p>}
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                </DialogActions>
            </DialogBody>}
            {rewritingDescriptions && <DialogBody>
                <DialogTitle>Rewriting descriptions to fit silent intervals</DialogTitle>
                <DialogContent>
                    {<ProgressBar />}
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                </DialogActions>
            </DialogBody>}
            {generatingAudio && <DialogBody>
                <DialogTitle>Generating audio</DialogTitle>
                <DialogContent>
                    <Field validationMessage={`Audio files generated:  ${numberOfAudioFilesGenerated} of ${props.scenes.length}`} validationState="none">
                        <ProgressBar max={props.scenes.length} value={numberOfAudioFilesGenerated}/>
                    </Field>
                </DialogContent>
                <DialogActions>
                    <Button appearance="secondary" onClick={() => props.setOpenProcessDialog(false)}>Cancel</Button>
                </DialogActions>
            </DialogBody>}
            {loadingAudio && <DialogBody>
                <DialogTitle>Preparing video player...</DialogTitle>
                <DialogContent>
                    <ProgressBar />
                </DialogContent>
            </DialogBody>}
        </DialogSurface>
    </Dialog>
</>
}