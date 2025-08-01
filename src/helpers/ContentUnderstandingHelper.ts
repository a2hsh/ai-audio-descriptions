// --- Modular Audio Description Prompt System ---
export const GLOBAL_SYSTEM_PROMPT: { [key: string]: string } = {
  "en-US": `You are a certified Audio-Description Writer.\n• Target audience: blind & low-vision viewers.\n• Follow WCAG 2.2 + ACME Broadcaster AD style.\n• Use present tense, third-person, neutral tone.\n• Describe ONLY what the viewer cannot hear.\n• Read on-screen text EXACTLY verbatim.\n• Never reveal future plot or character motives.\n• Never exceed the word cap provided in payload.`,
  "ar-SA": `أنت كاتب وصف صوتي معتمد.\n• الجمهور المستهدف: المكفوفون وضعاف البصر.\n• اتبع WCAG 2.2 + أسلوب البث الاحترافي.\n• استخدم زمن المضارع، ضمير الغائب، نبرة محايدة.\n• صف فقط ما لا يمكن للمشاهد سماعه.\n• اقرأ النص الظاهر على الشاشة حرفياً.\n• لا تكشف أحداث المستقبل أو دوافع الشخصيات.\n• لا تتجاوز الحد الأقصى للكلمات المحدد في الطلب.`,
  "es-ES": `Eres un guionista de audiodescripción certificado.\n• Audiencia: personas ciegas o con baja visión.\n• Sigue WCAG 2.2 + estilo ACME Broadcaster.\n• Usa presente, tercera persona, tono neutral.\n• Describe SOLO lo que no se puede oír.\n• Lee el texto en pantalla EXACTAMENTE como aparece.\n• Nunca reveles futuros eventos o motivos.\n• Nunca superes el límite de palabras del payload.`,
  "fr-FR": `Vous êtes un rédacteur d’audiodescription certifié.\n• Public cible : personnes aveugles ou malvoyantes.\n• Respectez WCAG 2.2 + style diffuseur professionnel.\n• Utilisez le présent, la troisième personne, un ton neutre.\n• Décrivez UNIQUEMENT ce que le spectateur n’entend pas.\n• Lisez le texte à l’écran EXACTEMENT tel quel.\n• Ne révélez jamais l’intrigue future ou les motifs.\n• Ne dépassez jamais le nombre de mots indiqué dans la requête.`
} as const;

const SEGMENT_CONTRACT = `Return **ONLY** valid JSON:\n{\n  "description": "<string, ≤{{maxWords}} words>",\n  "wordCount": <integer>\n}\n\nRules:\n1. wordCount MUST equal the number of words in description.\n2. If on-screen text exists, embed it verbatim inside the flow.\n3. Do not repeat any previous segment’s visuals.\n4. Do not anticipate next segment.`;

import axios from "axios";
import { aiServicesResource, aiServicesKey, gptDeployment } from "../keys";
import { delay, GenerateId, msToTime, timeToMs } from "./Helper";
import { Segment } from "../Models";
import { Content, ContentUnderstandingResults } from "../ContentUnderstandingModels";

export const createContentUnderstandingAnalyzer = async (title: string, metadata: string, narrationStyle: string, languageCode: string = 'en-US') => {
    let description_prompt = "";
    
    // Set language-specific prompts
    switch (languageCode) {
        case 'ar-SA':
        case 'ar-EG':
            description_prompt = `أنت مولد وصف صوتي محترف مختص في إنشاء أوصاف صوتية للفيديوهات لمساعدة المكفوفين وضعاف البصر. الوصف الصوتي هو خدمة إمكانية وصول حيوية توفر سرداً منطوقاً للعناصر البصرية خلال الفترات الصامتة الطبيعية في الحوار، مما يتيح للجمهور الأعمى وضعيف البصر تجربة المحتوى المرئي بالكامل.

## هدفك الأساسي:
أنت كاتب وصف صوتي خبير مدرب على المعايير المهنية المستخدمة من قبل المذيعين الرئيسيين وخدمات البث وقاعات السينما. يجب أن تتطابق أوصافك مع جودة وأسلوب مسارات الوصف الصوتي المنتجة مهنياً.

## المبادئ الأساسية:

### 1. إمكانية الوصول أولاً
- هدفك الأساسي هو جعل المحتوى المرئي قابلاً للوصول للمشاهدين المكفوفين وضعاف البصر
- افترض أن جمهورك لا يستطيع رؤية أي شيء على الشاشة ويعتمد كلياً على أوصافك
- كل عنصر بصري مهم يساهم في الفهم يجب وصفه

### 2. المعايير المهنية
- اتبع إرشادات الوصف الصوتي المعتمدة المستخدمة في الصناعة
- اكتب بنفس مستوى الاحترافية لمقدمي الوصف الصوتي المعتمدين
- حافظ على الاتساق مع المصطلحات والعبارات التقليدية للوصف الصوتي

## إرشادات الكتابة التفصيلية:

### ما يجب وصفه:
✅ **الأفعال البصرية الأساسية**: حركات الشخصيات، الإيماءات، تعبيرات الوجه التي تنقل المشاعر أو المعنى
✅ **إعدادات المشهد**: المواقع، وقت اليوم، الطقس، التغييرات البيئية
✅ **مظاهر الشخصيات**: عند ظهور شخصيات جديدة، صف العمر، الملابس، الملامح المميزة ذات الصلة بالقصة
✅ **النص المرئي (مهم جداً)**: اقرأ أي نص يظهر على الشاشة بالضبط كما هو مكتوب - العناوين، اللافتات، الوثائق، الرسائل، التسميات التوضيحية، أو أي كتابة مرئية. لا تلخص أو تغير النص - اقرأه حرفياً
✅ **عناصر السرد البصري**: الفكاهة البصرية، الصور الرمزية، الرموز المهمة
✅ **مشاهد الحركة**: مشاهد القتال، مطاردات، الكوميديا الجسدية - صف التطور بوضوح
✅ **الإشارات العاطفية البصرية**: الدموع، الابتسامات، لغة الجسد التي تكشف مشاعر الشخصية
✅ **المرئيات الحاسمة للحبكة**: الأشياء، الوثائق، الخرائط، أو المعلومات البصرية الأساسية للفهم

### ما لا يجب وصفه:
❌ **المعلومات المكررة**: لا تكرر ما هو واضح بالفعل من الحوار أو الصوت
❌ **الأفعال الواضحة**: لا تصف الأفعال الأساسية إذا كانت واضحة من الصوت
❌ **التفسير**: تجنب شرح المعاني أو الدوافع أو آثار الحبكة المستقبلية
❌ **التفاصيل المفرطة**: لا تصف كل عنصر بصري بسيط - ركز على ما هو مهم سردياً

### اللغة والأسلوب:

**النبرة**: مهنية، واضحة، وموضوعية - مثل راوٍ ماهر
**الزمن**: المضارع للحدث الحالي، الماضي فقط عند الإشارة إلى أحداث سابقة
**الصوت**: الغائب، حافظ على المسافة السردية
**المفردات**: 
- استخدم لغة دقيقة واقتصادية
- اختر أفعالاً قوية ومحددة بدلاً من العامة
- استخدم مصطلحات السينما/التلفزيون عند الاقتضاء
- تجنب اللغة المزهرة أو الدرامية المفرطة إلا إذا تطابق مع نبرة المحتوى

**بنية الجملة**:
- نوع في أطوال الجمل للحصول على إيقاع طبيعي
- استخدم جملاً قصيرة وواضحة لمشاهد الحركة
- الجمل الأطول مقبولة لوصف الإعدادات خلال فترات توقف الحوار
- ابدأ بأهم المعلومات في كل جملة

### التوقيت والوتيرة:
- **ملائمة الوقت المتاح**: يجب أن تناسب الأوصاف الفترات الصامتة دون عجلة أو انقطاع
- **إعطاء الأولوية للمعلومات**: إذا كان الوقت محدوداً، صف أهم المرئيات للحبكة أولاً
- **الإيقاع الطبيعي**: اكتب ليُقرأ بصوت عالٍ - تأكد من تدفق الأوصاف بسلاسة عند القراءة

### الاعتبارات التقنية:
- **وعي السياق السابق**: لا تكرر المعلومات من الأوصاف الحديثة
- **الاستمرارية**: حافظ على الاتساق في أوصاف الشخصيات والمواقع
- **تماسك المشهد**: ساعد المشاهدين على فهم العلاقات المكانية وجغرافية المشهد

## معايير الجودة:

**ممتاز**: "تدخل سارة المطعم خافت الإضاءة، قطرات المطر تتساقط من معطفها الأحمر. تتفحص الكبائن الفارغة قبل أن تلمح ماركوس في الزاوية، رأسه بين يديه."

**ضعيف**: "امرأة تدخل مكاناً. تنظر حولها وترى رجلاً."

اكتب وصفاً صوتياً باللغة العربية يصف ما حدث عبر الإطارات في هذا المشهد. لا تكرر معلومات من الوصف السابق. لا تكرر معلومات موجودة في النص المكتوب. لا تشرح معنى الأشياء. اكتب بوضوح وبساطة واحترافية.

`;
            break;
        case 'es-ES':
            description_prompt = "Escribe una pista de audiodescripción en español describiendo lo que pasó a través de los fotogramas en esta escena. No repitas información de la descripción anterior. No repitas información del transcrito. No expliques lo que significan las cosas. Escribe con claridad y sencillez.\n\nIMPORTANTE: Si aparece algún texto en pantalla (títulos, letreros, documentos, mensajes, subtítulos, etiquetas, o cualquier escritura visible), léelo exactamente tal como aparece palabra por palabra. No resumas ni parafrasees el texto.\n\n";
            break;
        case 'fr-FR':
            description_prompt = "Écrivez une piste d'audiodescription en français décrivant ce qui s'est passé à travers les images de cette scène. Ne répétez pas les informations de la description précédente. Ne répétez pas les informations de la transcription. N'expliquez pas ce que signifient les choses. Écrivez avec clarté et simplicité.\n\nIMPORTANT: Si du texte apparaît à l'écran (titres, panneaux, documents, messages, sous-titres, étiquettes, ou toute écriture visible), lisez-le exactement mot pour mot tel qu'il apparaît. Ne résumez pas et ne paraphrasez pas le texte.\n\n";
            break;
        default:
            description_prompt = "You are a professional Audio Description Generator, specifically designed to create audio descriptions for videos to assist blind and visually impaired viewers. Write an audio description track in English describing what happened across the frames in this scene. Do not repeat information from the previous description. Do not repeat information in the transcript. Do not explain what things mean. Write clearly and simply.\n\nIMPORTANT: If any text appears on screen (titles, signs, documents, messages, captions, labels, or any visible writing), read it exactly verbatim as it appears. Do not summarize or paraphrase text - read it word-for-word.\n\n";
    }
    
    description_prompt += "Use the below information about the video to enhance the descriptions:\n\n"
    + (title ?? "") || `* Title: ${title}\n`
    + (metadata ?? "") || `* Context: ${metadata}\n`
    + (narrationStyle ?? "") || `Writing Style: ${narrationStyle}\n`;

    const id = GenerateId();
    const url = getContentUnderstandingBaseUrl(id);

    const data = {
        description: "Audio Description video analyzer",
        scenario: "videoShot",
        config: {
          returnDetails: true
        },
        fieldSchema: {
          fields: {
            Description: {
              type: "string",
              description: description_prompt
            }
          }
        }
      };

    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0"
        }
    }
    const result = await axios.put(url, data, config);
    
    const statusUrl = result.headers["operation-location"].toString();
    let statusResult = await axios.get(statusUrl, config);

    while(statusResult.data.status?.toLowerCase() !== "succeeded") {
        await new Promise(r => setTimeout(r, 1000));
        statusResult = await axios.get(statusUrl, config);
    }
    return result.data;    
};

export const createAnalyzeFileTask = async (analyzerId: string, videoUrl: string) => {
    const url = getContentUnderstandingBaseUrl(analyzerId, ":analyze");
    const data = {
        url: videoUrl
    };
    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0"
        }
      }
    const result = await axios.post(url, data, config);
    return result.data;    
};

export const getAnalyzeTaskInProgress = async (analyzerId: string, taskId: string): Promise<ContentUnderstandingResults> => {
    const url = getContentUnderstandingBaseUrl(analyzerId, `/results/${taskId}`);
    const config = {
        headers: {
            "ocp-apim-subscription-key": aiServicesKey,
            "x-ms-useragent": "ai-audio-descriptions/1.0"
        }
      }
    const result = await axios.get(url, config);
    return result.data;
}

export const getAudioDescriptionsFromAnalyzeResult = async (result: Content[], title: string, metadata: string, narrationStyle: string, languageCode: string = 'en-US') : Promise<Segment[]> => {
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
                `SEGMENT ${idx + 1}: ${segment.startTimeMs}-${segment.endTimeMs} (${(durationMs/1000).toFixed(3)}s) | ${isSilent ? 'SILENT' : 'SPEECH'}\n` +
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
    for (let i = 0; i < mergedIntervals.length; i++) {
        const segment = mergedIntervals[i];
        const duration = timeToMs(segment.endTime) - timeToMs(segment.startTime);
        const durationInSeconds = duration / 1000;
        const wordCount = Math.floor(durationInSeconds * wordCountPerSecond);

        // Improved minimum word count logic
        let minWords = 3;
        const maxWords = 50; // Cap very long segments
        // For Arabic, always use minWords = 8
        if (languageCode === 'ar-SA' || languageCode === 'ar-EG') {
            minWords = 8;
        }
        // CRITICAL: First 2-3 descriptions need to be clear and context-setting
        if (i < 3) {
            minWords = Math.max(minWords, 10);
        }
        // If the original segment had <2 transcript phrases, boost minWords for more detail
        const orig = allSegmentsInTheVideo.find(s => msToTime(s.startTime) === segment.startTime && msToTime(s.endTime) === segment.endTime);
        if (orig && orig.transcriptPhraseCount !== undefined && orig.transcriptPhraseCount < 2) {
            minWords = Math.max(minWords, 10);
        }
        const adjustedWordCount = Math.max(minWords, Math.min(maxWords, wordCount));

        let nextDescription = "";
        if (i < mergedIntervals.length - 1) {
            nextDescription = mergedIntervals[i + 1].description || "";
        }

        // --- Compose modular prompt ---
        const globalSystem = (GLOBAL_SYSTEM_PROMPT[languageCode] || GLOBAL_SYSTEM_PROMPT["en-US"]) +
            "\n\n[SCENE CONTINUITY]: Ensure the description flows naturally from the previous context. Avoid repeating details already mentioned in the last 2-3 segments. Focus on what is new, changed, or important for the listener to follow the scene. Use transitions or linking phrases if appropriate.";
        const segmentContract = SEGMENT_CONTRACT.replace("{{maxWords}}", adjustedWordCount.toString());
        // Pass the last 3 previous descriptions for context
        const prevContextArr = previousDescriptions.slice(-3);
        const payload = {
            title,
            context: metadata,
            language: languageCode,
            narrationStyle,
            maxWords: adjustedWordCount,
            previousDescriptions: prevContextArr,
            originalDescription: segment.description,
            nextDescription
        };
        const messages = [
            { role: "system", content: globalSystem },
            { role: "system", content: segmentContract },
            { role: "user", content: JSON.stringify(payload) }
        ];

        // Log the full prompt for this GPT call
        logLines.push(
            `\n[GPT PROMPT] SYSTEM (global):\n${globalSystem.substring(0, 2000)}${globalSystem.length > 2000 ? '\n...TRUNCATED...' : ''}`
        );
        logLines.push(
            `[GPT PROMPT] SYSTEM (contract):\n${segmentContract.substring(0, 2000)}${segmentContract.length > 2000 ? '\n...TRUNCATED...' : ''}`
        );
        logLines.push(
            `[GPT PROMPT] USER:\n${JSON.stringify(payload).substring(0, 2000)}${JSON.stringify(payload).length > 2000 ? '\n...TRUNCATED...' : ''}`
        );

        // --- Call GPT and parse JSON response ---
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
                // fallback: try to extract description as string
                rewriteResult = typeof gptResponse === 'string' ? gptResponse : '';
                actualWordCount = rewriteResult.trim().split(/\s+/).length;
                responseObj = null;
            }
            // Accept if wordCount matches maxWords exactly or within ±2
            if (Math.abs(actualWordCount - adjustedWordCount) <= 2) break;
            retry++;
        }

        // Log original and rewritten description side by side for debugging
        logLines.push(
            `  [ORIGINAL] Combined: ${JSON.stringify(segment.description).substring(0, 300)}\n` +
            `  [REWRITTEN] (target: ${adjustedWordCount}, actual: ${actualWordCount} words, retries: ${retry})\n` +
            `    ${JSON.stringify(rewriteResult).substring(0, 300)}\n` +
            `    Previous context: ${JSON.stringify(prevContextArr.join(' | ')).substring(0, 200)}\n` +
            (actualWordCount > adjustedWordCount + 2 ? `    [WARN] Description is too long!\n` : '') +
            (actualWordCount < adjustedWordCount - 2 ? `    [WARN] Description is too short!\n` : '') +
            (retry > 0 ? `    [INFO] Retried ${retry} time(s) for word count enforcement.\n` : '') +
            `---`
        );

        segment.description = rewriteResult;
        previousDescriptions.push(rewriteResult);
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
        // fallback: just log to console
        console.log('Failed to download log file:', e);
        console.log(logLines.join('\n'));
    }

    return mergedIntervals
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
    return `https://${aiServicesResource}.cognitiveservices.azure.com/contentunderstanding/analyzers/${analyzerId}${operation ? operation : ""}?api-version=2024-12-01-preview`
}