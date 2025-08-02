// Helper to extract segments from analyzer result and rewrite them
/**
 * Given a ContentUnderstandingResults object, extracts the segments and rewrites them using GPT.
 * Returns the rewritten segments array.
 */
export const getRewrittenSegmentsFromAnalyzerResult = async (
  analyzerResult: ContentUnderstandingResults,
  title: string,
  metadata: string,
  narrationStyle: string,
  languageCode: string = 'en-US'
) => {
  // Defensive: find the first .contents[0].segments or .contents[0].fields?.Segments?.valueArray
  let segmentsRaw: any[] = [];
  if (analyzerResult?.result?.contents && analyzerResult.result.contents.length > 0) {
    const content = analyzerResult.result.contents[0] as any;
    if (Array.isArray(content.segments)) {
      // If segments is present (array of {startTimeMs, endTimeMs, description, ...})
      segmentsRaw = content.segments.map((seg: any) => ({
        startTimeMs: seg.startTimeMs,
        endTimeMs: seg.endTimeMs,
        description: seg.description,
        transcriptPhrases: seg.transcriptPhrases || [],
        fields: { description: { valueString: seg.description } },
        startTime: seg.startTimeMs,
        endTime: seg.endTimeMs
      }));
    } else if (
      content.fields &&
      (content.fields as any).Segments &&
      Array.isArray((content.fields as any).Segments.valueArray)
    ) {
      // If fields.Segments.valueArray is present (array of objects with valueObject.Description.valueString)
      segmentsRaw = ((content.fields as any).Segments.valueArray as any[]).map((item: any, index: number) => {
        const desc = item.valueObject?.Description?.valueString || '';
        // Try to extract timing from the original segments if available
        const originalSeg = content.segments?.[index];
        const startTimeMs = originalSeg?.startTimeMs ?? item.startTimeMs ?? 0;
        const endTimeMs = originalSeg?.endTimeMs ?? item.endTimeMs ?? (startTimeMs + 5000); // fallback: 5s duration
        const transcriptPhrases = originalSeg?.transcriptPhrases ?? item.transcriptPhrases ?? [];
        
        return {
          startTimeMs,
          endTimeMs,
          description: desc,
          transcriptPhrases,
          fields: { description: { valueString: desc } },
          startTime: startTimeMs,
          endTime: endTimeMs
        };
      });
    }
  }
  // Fallback: try to extract segments from other possible shapes
  if (!segmentsRaw.length && (analyzerResult.result as any)?.segments && Array.isArray((analyzerResult.result as any).segments)) {
    segmentsRaw = ((analyzerResult.result as any).segments as any[]).map((seg: any) => ({
      startTimeMs: seg.startTimeMs ?? 0,
      endTimeMs: seg.endTimeMs ?? (seg.startTimeMs + 5000),
      description: seg.description ?? '',
      transcriptPhrases: seg.transcriptPhrases || [],
      fields: { description: { valueString: seg.description ?? '' } },
      startTime: seg.startTimeMs ?? 0,
      endTime: seg.endTimeMs ?? (seg.startTimeMs + 5000)
    }));
  }
  // If no segments found, throw
  if (!segmentsRaw.length) throw new Error('No segments found in analyzer result.');

  // Validate that segments have timing information
  const validSegments = segmentsRaw.filter(seg => 
    typeof seg.startTimeMs === 'number' && 
    typeof seg.endTimeMs === 'number' && 
    seg.endTimeMs > seg.startTimeMs
  );
  
  if (!validSegments.length) {
    throw new Error('No segments with valid timing information found in analyzer result.');
  }

  // Call the rewriting/generation logic
  return await getAudioDescriptionsFromAnalyzeResult(
    validSegments,
    title,
    metadata,
    narrationStyle,
    languageCode
  );
};
// --- Modular Audio Description Prompt System ---
export const GLOBAL_SYSTEM_PROMPT: { [key: string]: string } = {
    "en-US": `You are a certified Audio-Description Writer.\n• Target audience: blind & low-vision viewers.\n• Follow WCAG 2.2 + ACME Broadcaster AD style.\n• Use present tense, third-person, neutral tone.\n• Describe ONLY what the viewer cannot hear.\n• Read on-screen text EXACTLY verbatim.\n• Never reveal future plot or character motives.\n• Never exceed the word cap provided in payload.`,
    "ar-SA": `أنت كاتب وصف صوتي معتمد.\n• الجمهور المستهدف: المكفوفون وضعاف البصر.\n• اتبع WCAG 2.2 + أسلوب البث الاحترافي.\n• استخدم زمن المضارع، ضمير الغائب، نبرة محايدة.\n• صف فقط ما لا يمكن للمشاهد سماعه.\n• اقرأ النص الظاهر على الشاشة حرفياً.\n• لا تكشف أحداث المستقبل أو دوافع الشخصيات.\n• لا تتجاوز الحد الأقصى للكلمات المحدد في الطلب.`,
    "es-ES": `Eres un guionista de audiodescripción certificado.\n• Audiencia: personas ciegas o con baja visión.\n• Sigue WCAG 2.2 + estilo ACME Broadcaster.\n• Usa presente, tercera persona, tono neutral.\n• Describe SOLO lo que no se puede oír.\n• Lee el texto en pantalla EXACTAMENTE como aparece.\n• Nunca reveles futuros eventos o motivos.\n• Nunca superes el límite de palabras del payload.`,
    "fr-FR": `Vous êtes un rédacteur d’audiodescription certifié.\n• Public cible : personnes aveugles ou malvoyantes.\n• Respectez WCAG 2.2 + style diffuseur professionnel.\n• Utilisez le présent, la troisième personne, un ton neutre.\n• Décrivez UNIQUEMENT ce que le spectateur n’entend pas.\n• Lisez le texte à l’écran EXACTEMENT tel quel.\n• Ne révélez jamais l’intrigue future ou les motifs.\n• Ne dépassez jamais le nombre de mots indiqué dans la requête.`
} as const;

const SEGMENT_CONTRACT = `Return **ONLY** valid JSON:\n{\n  "description": "<string, ≤{{maxWords}} words>",\n  "wordCount": <integer>\n}\n\nRules:\n1. wordCount MUST equal the number of words in description.\n2. If on-screen text exists, you MUST embed it verbatim, word-for-word, exactly as it appears, inside the flow.\n3. NEVER summarize, paraphrase, or alter on-screen text.\n4. NEVER hallucinate or invent any text that does not appear on screen.\n5. Do not repeat any previous segment’s visuals.\n6. Do not anticipate next segment.`;

import axios from "axios";
import { aiServicesResource, aiServicesKey, gptDeployment } from "../keys";
import { delay, GenerateId, msToTime, timeToMs } from "./Helper";
import { Segment } from "../Models";
import { Content, ContentUnderstandingResults } from "../ContentUnderstandingModels";

const analyserPrompts = {
    "en-US": `You are a professional Audio Description Generator specialized in creating audio descriptions for videos to assist blind and low-vision viewers. Audio description is an accessibility service that provides spoken narration of visual elements in a video, such as actions, settings, and on-screen text, to ensure that viewers who cannot see the video can understand its content.\n\nWrite an audio description in English that describes what happens across the frames in this scene. Do not repeat information from the previous description. Do not repeat information already present in the written text. Do not explain the meaning of things. Write clearly, simply, and professionally.`,
    "ar-SA": `أنت مولد وصف صوتي محترف مختص في إنشاء أوصاف صوتية للفيديوهات لمساعدة المكفوفين وضعاف البصر. الوصف الصوتي هو خدمة إمكانية وصول توفر سردًا منطوقًا للعناصر المرئية في الفيديو، مثل الأفعال والإعدادات والنصوص المعروضة على الشاشة، لضمان فهم المشاهدين الذين لا يستطيعون رؤية الفيديو لمحتواه.\n\nاكتب وصفاً صوتياً باللغة العربية يصف ما حدث عبر الإطارات في هذا المشهد. لا تكرر معلومات من الوصف السابق. لا تكرر معلومات موجودة في النص المكتوب. لا تشرح معنى الأشياء. اكتب بوضوح وبساطة واحترافية.`,
    "es-ES": `Eres un generador profesional de audiodescripción especializado en crear descripciones de audio para videos que ayudan a personas ciegas y con baja visión. La audiodescripción es un servicio de accesibilidad que proporciona una narración hablada de los elementos visuales en un video, como acciones, escenarios y texto en pantalla, para asegurar que los espectadores que no pueden ver el video comprendan su contenido.\n\nEscribe una pista de audiodescripción en español que describa lo que sucede a través de los fotogramas en esta escena. No repitas información de la descripción anterior. No repitas información ya presente en el texto escrito. No expliques el significado de las cosas. Escribe con claridad, sencillez y profesionalidad.`,
    "fr-FR": `Vous êtes un générateur professionnel d’audiodescription spécialisé dans la création de descriptions audio pour les vidéos afin d’aider les personnes aveugles et malvoyantes. L’audiodescription est un service d’accessibilité qui fournit une narration parlée des éléments visuels d’une vidéo, tels que les actions, les décors et le texte à l’écran, pour s’assurer que les spectateurs qui ne peuvent pas voir la vidéo comprennent son contenu.\n\nRédigez une description audio en français qui décrit ce qui se passe à travers les images dans cette scène. Ne répétez pas les informations de la description précédente. Ne répétez pas les informations déjà présentes dans le texte écrit. N’expliquez pas la signification des choses. Écrivez de manière claire, simple et professionnelle.`
}

export const createContentUnderstandingAnalyzer = async (
    title: string,
    metadata: string,
    narrationStyle: string,
    languageCode: string = "en-US"
) => {
    let description_prompt = analyserPrompts[languageCode as keyof typeof analyserPrompts] || analyserPrompts["en-US"];

    // --- Safe concatenation (fixes the + || precedence bug) ---
    description_prompt += "Use the below information about the video to enhance the descriptions:\n\n";
    if (title) description_prompt += `* Title: ${title}\n`;
    if (metadata) description_prompt += `* Context: ${metadata}\n`;
    if (narrationStyle) description_prompt += `* Writing Style: ${narrationStyle}\n`;

    // --- Build analyzer on top of the prebuilt video analyzer (enables STT/transcript) ---
    const id = GenerateId();
    const url = getContentUnderstandingBaseUrl(id); // NOTE: ensure this uses api-version=2025-05-01-preview

    const data = {
        description: "Audio Description video analyzer",
        baseAnalyzerId: "prebuilt-videoAnalyzer",
        config: {
            returnDetails: true,
            locales: Array.from(new Set([languageCode, "en-US"])), // speech hints
            segmentationMode: "auto"
        },
        fieldSchema: {
            // optional: name/description, purely cosmetic
            // name: "AudioDescriptionSchema",
            // description: "Per-segment AD fields",
            fields: {
                Segments: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            // (optional) IDs or timing placeholders if you want them in fields too
                            // SegmentId: { type: "string" },
                            // Start: { type: "time", method: "extract" },
                            // End:   { type: "time", method: "extract" },

                            // The generated AD text goes here
                            Description: {
                                type: "string",
                                method: "generate",
                                description: description_prompt
                            }
                        }
                    }
                }
            }
        }
    };

    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0",
        },
    };

    try {
        // LRO: create analyzer
        const putResult = await axios.put(url, data, config);
        const statusUrl = String(putResult.headers["operation-location"]);

        // Poll until succeeded
        let statusResult = await axios.get(statusUrl, config);
        while (String(statusResult.data.status).toLowerCase() !== "succeeded") {
            await delay(1000);
            statusResult = await axios.get(statusUrl, config);
        }

        // Return the actual analyzer id you created (not the raw PUT payload)
        return { analyzerId: id };
    } catch (err: any) {
        // Bubble up a concise, useful error
        const msg =
            err?.response?.data?.error?.message ||
            err?.message ||
            "Failed to create Content Understanding analyzer.";
        throw new Error(msg);
    }
};



export const createAnalyzeFileTask = async (analyzerId: string, videoUrl: string) => {
  if (!videoUrl || typeof videoUrl !== "string" || videoUrl.trim() === "") {
    throw new Error("A valid, non-empty videoUrl must be provided to analyze.");
  }
  const url = getContentUnderstandingBaseUrl(analyzerId, ":analyze");
  const data = { url: videoUrl };
  const config = {
    headers: {
      "ocp-apim-subscription-key": aiServicesKey,
      "x-ms-useragent": "ai-audio-descriptions/1.0",
      "Content-Type": "application/json",
    },
  };

  const res = await axios.post(url, data, config);

  const operationLocation = String(res.headers["operation-location"] || "");
  if (!operationLocation) {
    throw new Error("Missing operation-location header from :analyze response.");
  }

  // e.g. https://.../contentunderstanding/analyzerResults/{taskId}?api-version=...
  const taskId = operationLocation.split("/").pop()?.split("?")[0] || "";

  return {
    operationLocation,
    taskId,
    initial: res.data, // optional, keep if you need it
  };
};

export const getAnalyzeTaskInProgress = async (
  arg1: string,
  maybeTaskId?: string
): Promise<ContentUnderstandingResults> => {
  // Backward-compatible signature:
  // - If caller passes (operationLocation) -> use it directly.
  // - If caller passes (analyzerId, taskId) -> we'll ignore analyzerId and build analyzerResults URL from taskId.

  const isOperationLocation = arg1.includes("/analyzerResults/");
  const url = isOperationLocation
    ? arg1 // full operation-location returned by :analyze
    : getAnalyzerResultsUrl(String(maybeTaskId)); // build /analyzerResults/{taskId}

  const config = {
    headers: {
      "ocp-apim-subscription-key": aiServicesKey,
      "x-ms-useragent": "ai-audio-descriptions/1.0",
    },
  };

  const res = await axios.get(url, config);
  return res.data as ContentUnderstandingResults;
};

export const getAudioDescriptionsFromAnalyzeResult = async (result: Content[], title: string, metadata: string, narrationStyle: string, languageCode: string = 'en-US'): Promise<Segment[]> => {
    // In-browser log collection
    const logLines: string[] = [];

    // Parse segments and mark silence
    const allSegmentsInTheVideo = result
        .map((segment: Content, idx: number) => {
            let description = "";
            if (segment.fields && segment.fields.description && typeof segment.fields.description.valueString === "string") {
                description = segment.fields.description.valueString;
            }
            const isSilent = segment.transcriptPhrases.length === 0;
            const durationMs = segment.endTimeMs - segment.startTimeMs;
            logLines.push(
                `SEGMENT ${idx + 1}: ${segment.startTimeMs}-${segment.endTimeMs} (${(durationMs / 1000).toFixed(3)}s) | ${isSilent ? 'SILENT' : 'SPEECH'}\n` +
                `  Original: ${JSON.stringify(description).substring(0, 300)}\n` +
                `  Transcript phrases: ${segment.transcriptPhrases.length}\n`
            );
            return {
                startTime: segment.startTimeMs,
                endTime: segment.endTimeMs,
                description,
                isSilent,
                transcriptPhraseCount: segment.transcriptPhrases.length,
                durationMs
            };
        })
        // Only keep segments >= 200ms, and for silence, skip if <3s unless will be merged
        .filter(seg => (seg.endTime - seg.startTime) >= 200 && (seg.isSilent ? seg.durationMs >= 3000 : true));

    // Identify silent and speech segments
    const silentSegments = allSegmentsInTheVideo.filter(s => s.isSilent);
    const speechSegments = allSegmentsInTheVideo.filter(s => !s.isSilent && s.description && s.description.trim().length > 0);

    // Build silent intervals (never overlapping speech)
    const silentIntervals: Segment[] = [];
    for (const seg of silentSegments) {
        silentIntervals.push({
            startTime: msToTime(seg.startTime),
            endTime: msToTime(seg.endTime),
            description: seg.description
        });
    }

    // Assign each speech segment's visual description to the nearest silent interval (prefer after, else before)
    for (const speech of speechSegments) {
        const speechMid = (speech.startTime + speech.endTime) / 2;
        let minDist = Infinity;
        let nearestIdx = -1;
        for (let i = 0; i < silentIntervals.length; i++) {
            const s = silentIntervals[i];
            const silentStart = timeToMs(s.startTime);
            const silentEnd = timeToMs(s.endTime);
            // Prefer silent intervals after speech, but fallback to before if none after
            let dist = silentStart >= speech.endTime ? silentStart - speech.endTime : speech.startTime - silentEnd;
            if (dist < 0) dist = Math.abs((silentStart + silentEnd) / 2 - speechMid); // fallback: closest
            if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
            }
        }
        if (nearestIdx !== -1) {
            const silentDesc = silentIntervals[nearestIdx].description || "";
            if (!silentDesc.includes(speech.description)) {
                silentIntervals[nearestIdx].description = (silentDesc ? silentDesc.trim() + ' ' : '') + speech.description.trim();
            }
        }
    }

    // Merge consecutive silent intervals if they are adjacent
    let mergedIntervals: Segment[] = [];
    let current: Segment | null = null;
    for (let i = 0; i < silentIntervals.length; i++) {
        const seg = silentIntervals[i];
        if (!current) {
            current = { ...seg };
        } else {
            if (current.endTime === seg.startTime) {
                current.endTime = seg.endTime;
                if (seg.description && seg.description.trim() !== current.description.trim()) {
                    current.description += " " + seg.description;
                }
            } else {
                mergedIntervals.push(current);
                current = { ...seg };
            }
        }
    }
    if (current) {
        mergedIntervals.push(current);
    }

    // Split any merged silent interval longer than 10s into 5s chunks
    const maxSilentChunkSec = 5;
    const maxSilentIntervalSec = 10;
    const splitLongSilentIntervals: Segment[] = [];
    for (const interval of mergedIntervals) {
        const startMs = timeToMs(interval.startTime);
        const endMs = timeToMs(interval.endTime);
        const durationSec = (endMs - startMs) / 1000;
        if (durationSec > maxSilentIntervalSec) {
            let chunkStart = startMs;
            const descWords = interval.description.trim().split(/\s+/);
            let descIdx = 0;
            while (chunkStart < endMs) {
                const chunkEnd = Math.min(chunkStart + maxSilentChunkSec * 1000, endMs);
                const chunkDuration = (chunkEnd - chunkStart) / 1000;
                const chunkWordCount = Math.ceil(descWords.length * (chunkDuration / durationSec));
                const chunkDesc = descWords.slice(descIdx, descIdx + chunkWordCount).join(' ');
                splitLongSilentIntervals.push({
                    startTime: msToTime(chunkStart),
                    endTime: msToTime(chunkEnd),
                    description: chunkDesc
                });
                descIdx += chunkWordCount;
                chunkStart = chunkEnd;
            }
        } else {
            splitLongSilentIntervals.push(interval);
        }
    }
    mergedIntervals = splitLongSilentIntervals;

    // Log merged silent intervals
    logLines.push(`\n---\nCreated ${mergedIntervals.length} merged audio description intervals:\n`);
    mergedIntervals.forEach((interval, index) => {
        const duration = (timeToMs(interval.endTime) - timeToMs(interval.startTime)) / 1000;
        logLines.push(
            `Interval ${index + 1}: ${interval.startTime}-${interval.endTime} (${duration.toFixed(1)}s)\n` +
            `  Combined: ${JSON.stringify(interval.description).substring(0, 300)}\n`
        );
    });


    // Use mergedIntervals for rewriting
    // Language-specific speaking rates (words per second for natural speech)
    let wordCountPerSecond = 3;
    switch (languageCode) {
        case 'ar-SA':
        case 'ar-EG':
            wordCountPerSecond = 2.5; // Arabic is often spoken slower than English
            break;
        case 'es-ES':
            wordCountPerSecond = 3.2; // Spanish can be slightly faster
            break;
        case 'fr-FR':
            wordCountPerSecond = 2.8; // French moderate pace
            break;
        default:
            wordCountPerSecond = 3; // English default
    }

    // --- Modular prompt integration ---
    const previousDescriptions: string[] = [];
    const rewrittenDescriptions: string[] = [];
    for (let i = 0; i < mergedIntervals.length; i++) {
        const segment = mergedIntervals[i];
        const duration = timeToMs(segment.endTime) - timeToMs(segment.startTime);
        const durationInSeconds = duration / 1000;
        const wordCount = Math.floor(durationInSeconds * wordCountPerSecond);

        // --- Enhanced Arabic logic ---
        let minWords = 3;
        let maxWords = 50;
        let wordCountTolerance = 2;
        if (languageCode === 'ar-SA' || languageCode === 'ar-EG') {
            minWords = 12;
            maxWords = durationInSeconds > 7 ? 35 : 20;
            wordCountTolerance = 4;
        }
        if (i < 3) {
            minWords = Math.max(minWords, 14);
            maxWords = Math.max(maxWords, 25);
        }
        const orig = allSegmentsInTheVideo.find(s => msToTime(s.startTime) === segment.startTime && msToTime(s.endTime) === segment.endTime);
        if (orig && orig.transcriptPhraseCount !== undefined && orig.transcriptPhraseCount < 2) {
            minWords = Math.max(minWords, 14);
        }
        if (segment.description && segment.description.split(/\s+/).length > maxWords) {
            maxWords = Math.min(segment.description.split(/\s+/).length + 5, 45);
        }
        const adjustedWordCount = Math.max(minWords, Math.min(maxWords, wordCount));

        let nextDescription = "";
        if (i < mergedIntervals.length - 1) {
            nextDescription = mergedIntervals[i + 1].description || "";
        }

        const globalSystem = (GLOBAL_SYSTEM_PROMPT[languageCode] || GLOBAL_SYSTEM_PROMPT["en-US"]) +
            "\n\n[IMPORTANT]: If any text appears on screen (titles, signs, documents, messages, captions, labels, or any visible writing), you MUST read it exactly, word-for-word, as it appears. Do NOT summarize, paraphrase, or alter the text in any way. Do NOT hallucinate or invent any text. If there is no on-screen text, do not invent any.\n\n[SCENE CONTINUITY]: Ensure the description flows naturally from the previous context. Avoid repeating static details (lighting, architecture, etc.) or details already mentioned in the last 3 segments. Focus on what is new, changed, or important for the listener to follow the scene. Use linking phrases or transitions for better flow. If the interval is long, summarize the scene's progression.";
        const segmentContract = SEGMENT_CONTRACT.replace("{{maxWords}}", adjustedWordCount.toString());
        const prevContextArr = previousDescriptions.slice(-3);
        const payload = {
            title,
            context: metadata,
            language: languageCode,
            narrationStyle,
            maxWords: adjustedWordCount,
            previousDescriptions: prevContextArr,
            intervalIndex: i + 1,
            intervalStart: segment.startTime,
            intervalEnd: segment.endTime,
            originalDescription: segment.description,
            nextDescription
        };
        const messages = [
            { role: "system", content: globalSystem },
            { role: "system", content: segmentContract },
            { role: "user", content: JSON.stringify(payload) }
        ];

        logLines.push(
            `\n[GPT PROMPT] SYSTEM (global):\n${globalSystem.substring(0, 2000)}${globalSystem.length > 2000 ? '\n...TRUNCATED...' : ''}`
        );
        logLines.push(
            `[GPT PROMPT] SYSTEM (contract):\n${segmentContract.substring(0, 2000)}${segmentContract.length > 2000 ? '\n...TRUNCATED...' : ''}`
        );
        logLines.push(
            `[GPT PROMPT] USER:\n${JSON.stringify(payload).substring(0, 2000)}${JSON.stringify(payload).length > 2000 ? '\n...TRUNCATED...' : ''}`
        );

        let rewriteResult = "";
        let actualWordCount = 0;
        let retry = 0;
        const maxRetries = 6;
        let responseObj: any = null;
        while (retry <= maxRetries) {
            const gptResponse = await getGptOutputModular(messages);
            try {
                responseObj = typeof gptResponse === 'string' ? JSON.parse(gptResponse) : gptResponse;
                if (typeof responseObj === 'object' && responseObj.description && typeof responseObj.wordCount === 'number') {
                    rewriteResult = responseObj.description;
                    actualWordCount = responseObj.wordCount;
                } else {
                    throw new Error("Invalid JSON shape");
                }
            } catch {
                rewriteResult = typeof gptResponse === 'string' ? gptResponse : '';
                actualWordCount = rewriteResult.trim().split(/\s+/).length;
                responseObj = null;
            }
            if (Math.abs(actualWordCount - adjustedWordCount) <= wordCountTolerance) break;
            retry++;
        }

        logLines.push(
            `  [ORIGINAL] Combined: ${JSON.stringify(segment.description).substring(0, 300)}\n` +
            `  [REWRITTEN] (target: ${adjustedWordCount}, actual: ${actualWordCount} words, retries: ${retry})\n` +
            `    ${JSON.stringify(rewriteResult).substring(0, 300)}\n` +
            `    Previous context: ${JSON.stringify(prevContextArr.join(' | ')).substring(0, 200)}\n` +
            (actualWordCount > adjustedWordCount + wordCountTolerance ? `    [WARN] Description is too long!\n` : '') +
            (actualWordCount < adjustedWordCount - wordCountTolerance ? `    [WARN] Description is too short!\n` : '') +
            (retry > 0 ? `    [INFO] Retried ${retry} time(s) for word count enforcement.\n` : '') +
            `---`
        );

        rewrittenDescriptions.push(rewriteResult);
        previousDescriptions.push(rewriteResult);
    }

    // Overwrite mergedIntervals descriptions with rewritten ones
    for (let i = 0; i < mergedIntervals.length; i++) {
        mergedIntervals[i].description = rewrittenDescriptions[i];
    }

    // Download log as a text file
    try {
        const blob = new Blob([logLines.join('\n')], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `audio_description_log_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);
    } catch (e) {
        console.log('Failed to download log file:', e);
        console.log(logLines.join('\n'));
    }

    return mergedIntervals;
}

// Modular GPT output for new prompt structure
const getGptOutputModular = async (messages: any[]): Promise<string> => {
    const data = {
        messages,
        temperature: 0,
        max_tokens: 4096
    };
    const url = `https://${aiServicesResource}.openai.azure.com/openai/deployments/${gptDeployment}/chat/completions?api-version=2024-10-21`;
    const config = {
        headers: {
            "Content-Type": "application/json",
            "api-key": aiServicesKey
        }
    };
    let retry = 0;
    const maxRetries = 6;
    while (retry <= maxRetries) {
        try {
            const result = await axios.post(url, data, config);
            return result.data.choices[0].message.content;
        } catch (error: any) {
            // Exponential backoff for ETIMEDOUT or 5xx errors
            if (
                (error.code === "ETIMEDOUT") ||
                (error.response && error.response.status && error.response.status >= 500)
            ) {
                const wait = Math.min((2 ** retry) * 1000, 30000); // cap at 30s
                await delay(wait);
                retry++;
                continue;
            }
            if (error.response && error.response.status === 429) {
                console.log(error);
                await delay(20000);
                retry++;
                continue;
            }
            return "";
        }
    }
    return "";
};

const getContentUnderstandingBaseUrl = (analyzerId: string, operation?: string) => {
    return `https://${aiServicesResource}.cognitiveservices.azure.com/contentunderstanding/analyzers/${analyzerId}${operation ? operation : ""}?api-version=2025-05-01-preview`
};

const getAnalyzerResultsUrl = (taskId: string) => {
  return `https://${aiServicesResource}.cognitiveservices.azure.com/contentunderstanding/analyzerResults/${taskId}?api-version=2025-05-01-preview`;
};
