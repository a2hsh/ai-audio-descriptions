import React from "react";
import "./App.css";
import { SavedVideoResult, Segment } from "./Models";
import { DescriptionTable } from "./DescriptionTable";
import { VideoPlayer } from "./VideoPlayer";
import { getUploadedVideos } from "./helpers/BlobHelper";
import { MissingKeys } from "./MissingKeys";
import microsoftLogo from "./Microsoft-logo.png";

function App() {
    const [scenes, setScenes] = React.useState<Segment[]>([]);
    const [lastReadTime, setLastReadTime] = React.useState(-1);
    const [savedVideoListLoading, setSavedVideoListLoading] =
        React.useState(true);
    const [allVideos, setAllVideos] = React.useState<SavedVideoResult[]>([]);
    const [videoPlaying, setVideoPlaying] = React.useState(false);
    const [descriptionAvailable, setDescriptionAvailable] =
        React.useState(false);
    const [title, setTitle] = React.useState("");
    const [audioObjects, setAudioObjects] = React.useState<HTMLAudioElement[]>(
        []
    );
    const [originalVideoVolume, setOriginalVideoVolume] = React.useState(1.0);
    const [audioDescriptionVolume, setAudioDescriptionVolume] =
        React.useState(0.8);
    const [selectedLanguage, setSelectedLanguage] = React.useState("en-US");
    const [fadeInDuration, setFadeInDuration] = React.useState(0.5); // 0.5 seconds fade-in
    const [fadeOutDuration, setFadeOutDuration] = React.useState(0.5); // 0.5 seconds fade-out
    const [duckingEnabled, setDuckingEnabled] = React.useState(true); // Enable ducking by default

    const loadAllDescribedVideos = async () => {
        let allVideos: SavedVideoResult[] = [];
        try {
            allVideos = await getUploadedVideos();
        } catch (error) {
            console.error(error);
        }
        setAllVideos(allVideos);
        setSavedVideoListLoading(false);
    };

    React.useEffect(() => {
        if ("speechSynthesis" in window) {
            speechSynthesis.cancel();
        }
        loadAllDescribedVideos();
    }, []);

    const onVideoDeleted = () => {
        loadAllDescribedVideos();
    };

    return (
        <div className="App">
            <h1>AI Audio Descriptions</h1>
            <div className="container">
                <div className="half">
                    <MissingKeys />
                    <VideoPlayer
                        scenes={scenes}
                        setScenes={setScenes}
                        lastReadTime={lastReadTime}
                        setLastReadTime={setLastReadTime}
                        allVideos={allVideos}
                        videoPlaying={videoPlaying}
                        setVideoPlaying={setVideoPlaying}
                        descriptionAvailable={descriptionAvailable}
                        setDescriptionAvailable={setDescriptionAvailable}
                        title={title}
                        setTitle={setTitle}
                        videoListLoading={savedVideoListLoading}
                        audioObjects={audioObjects}
                        setAudioObjects={setAudioObjects}
                        onVideoDeleted={onVideoDeleted}
                        originalVideoVolume={originalVideoVolume}
                        setOriginalVideoVolume={setOriginalVideoVolume}
                        audioDescriptionVolume={audioDescriptionVolume}
                        setAudioDescriptionVolume={setAudioDescriptionVolume}
                        selectedLanguage={selectedLanguage}
                        setSelectedLanguage={setSelectedLanguage}
                        fadeInDuration={fadeInDuration}
                        setFadeInDuration={setFadeInDuration}
                        fadeOutDuration={fadeOutDuration}
                        setFadeOutDuration={setFadeOutDuration}
                        duckingEnabled={duckingEnabled}
                        setDuckingEnabled={setDuckingEnabled}
                    />
                </div>
                <div className="half">
                    <DescriptionTable
                        scenes={scenes}
                        setScenes={setScenes}
                        descriptionAvailable={descriptionAvailable}
                        setDescriptionAvailable={setDescriptionAvailable}
                        title={title}
                        setAudioObjects={setAudioObjects}
                        audioDescriptionVolume={audioDescriptionVolume}
                        selectedLanguage={selectedLanguage}
                    />
                    <div
                        style={{
                            marginTop: "10px",
                            fontSize: "12px",
                            color: "#666",
                        }}
                    >
                        Current Language: {selectedLanguage}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
