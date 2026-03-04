
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { ContentPreferences, PostInput, GeneratedPost } from "./types";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";

const toUnicodeBold = (text: string) => {
  const map: Record<string, string> = {
    'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚', 'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠',
    'N': '𝗡', 'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨', 'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
    'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴', 'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺',
    'n': '𝗻', 'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂', 'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
    '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱', '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵'
  };
  return text.split('').map(char => map[char] || char).join('');
};

const processMarkdownBold = (text: string) => {
  if (!text) return "";
  // 1. Convert literal \n sequences into actual newline characters
  let processed = text.replace(/\\n/g, '\n');

  // 2. Convert markdown **bold** into Unicode bold
  processed = processed.replace(/\*\*(.*?)\*\*/g, (_, content) => toUnicodeBold(content));

  return processed;
};

export const generatePostsText = async (
  sourceType: 'manual' | 'ai-guided',
  data: { brief?: string; manualEntries?: PostInput[]; customInstructions?: string },
  prefs: ContentPreferences,
  postCount: number
): Promise<Partial<GeneratedPost>[]> => {
  if (!API_KEY) {
    console.error("Gemini API Key is missing!");
    return [];
  }

  const genAI = new GoogleGenerativeAI(API_KEY);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            headline: { type: SchemaType.STRING },
            content: { type: SchemaType.STRING },
            hashtags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
            imagePrompt: { type: SchemaType.STRING, description: "Highly detailed artistic scene description without any brand names" }
          },
          required: ["headline", "content", "hashtags", "imagePrompt"]
        }
      }
    }
  });

  const systemInstruction = `You are a world-class LinkedIn growth strategist. Your goal is to replicate the "IDENTITY GOVERNANCE" post style EXACTLY.
  
  STRUCTURE TEMPLATE (FOLLOW THIS ORDER):
  1. MAIN HEADLINE: Start with a powerful 1-line headline in Unicode Bold (e.g., �����𝗶�𝘆 𝗚𝗼𝘃𝗲𝗿𝗻�𝗮𝗻𝗰𝗲: �������𝗻𝗴 ���𝗽��𝗮��𝗲).
  2. HOOK PARAGRAPH: 2-3 sentences with heavy bolding on key terms.
  3. SECTION HEADER: A 1-line sub-header in Unicode Bold (e.g., 𝗧𝗵𝗲 𝗘𝘀𝘀𝗲𝗻𝗰𝗲 𝗼𝗳 𝗜𝗚𝗔).
  4. BODY PARAGRAPHS: 1-2 SHORT paragraphs explaining the "what" and "why", with bolding on every key concept.
  5. BULLET POINTS: 3-4 points. Use Unicode Bold for the title (e.g., • 𝗕𝗼𝗹𝗱 𝗧𝗶𝘁𝗹𝗲: Regular text description).
  6. KEY INSIGHT: A single line starting with "𝗞𝗲𝘆 𝗜𝗻𝘀𝗶𝗴𝗵𝘁: [Bold text summary]".
  7. INTERACTION: A single-line question to drive comments.
  8. HASHTAGS: Use the format "#Keyword" (one after another).

  STYLING RULES:
  - BOLDING: Never use standard markdown like **bold**. STRICTLY use Unicode Bold (𝗲𝘅𝗮𝗺𝗽𝗹𝗲) for at least 3-5 words in every paragraph and all headers.
  - NO PREFIXES: Never start lines with extra letters like "s" or "f".
  - SPACING: Use actual newline characters for line breaks. Double line breaks between EVERY section.
  - IMAGE PROMPT: Create a specific "imagePrompt" for a visual infographic: 
    - "Process/Workflow": "High-end Flowchart infographic with nodes and arrows".
    - "Concepts/Ideas": "Premium Mindmap infographic with central hub".
    - "Vs/Differences": "Comparison VS chart infographic with split layout".
    Always specify: "Summary of [topic]".`;

  const prompt = sourceType === 'ai-guided'
    ? `${systemInstruction}\n\nTask: Generate ${postCount} diverse LinkedIn posts for this niche: "${data.brief}".\n${data.customInstructions ? `Special Note: ${data.customInstructions}` : ''}`
    : `${systemInstruction}\n\nTask: REWRITE these manual entries into the EXACT STRUCTURE above. Keep the core meaning but transform the layout to match the Identity Governance template.\n\nENTRIES:\n${data.manualEntries?.map(m => `- TOPIC: ${m.title}${m.content ? ` | CONTENT: ${m.content}` : ''}`).join('\n')}`;

  try {
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text() || "[]");

    // Auto-fix any markdown bold that the AI might have accidentally used
    const processed = (Array.isArray(parsed) ? parsed : []).map(post => ({
      ...post,
      headline: processMarkdownBold(post.headline || ""),
      content: processMarkdownBold(post.content || "")
    }));

    return processed.slice(0, postCount);
  } catch (e) {
    console.error("Gemini Text Gen Error:", e);
    try {
      const fallback = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
      const res = await fallback.generateContent(prompt);
      const parsedFallback = JSON.parse(res.response.text() || "[]");
      const processedFallback = (Array.isArray(parsedFallback) ? parsedFallback : []).map(post => ({
        ...post,
        headline: processMarkdownBold(post.headline || ""),
        content: post.content ? processMarkdownBold(post.content) : ""
      }));
      return processedFallback.slice(0, postCount);
    } catch (inner) { return []; }
  }
};

export const generatePostImage = async (imagePrompt: string): Promise<string> => {
  const genAI = new GoogleGenerativeAI(API_KEY);

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image" });

    const promptText = `Generate a high-end, professional infographic image. 
    TYPE: ${imagePrompt}.
    VISUAL STYLE: High-end corporate aesthetic, premium dark mode or clean white background, high-contrast text.
    CONTENT: This image must be a visual summary of the post's core message.
    REQUIREMENTS: 
    - NO BRANDING: Do NOT include any LinkedIn logos, social media icons, or brand names.
    - NO "LINKEDIN INSIGHTS": Do NOT include the text "LinkedIn Insights" or any variations thereof.
    - CLEAR TEXT: The main headings and key points must be legible and accurately spelled.
    - DIVERSITY: Use flowcharts, mindmaps, or comparison charts as requested in the type.
    - No generic stock photos of people shaking hands. Focus on logic, structure, and visual metaphors.
    - 8k resolution, minimalist but data-rich.`;

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: promptText }] }]
    });

    const response = await result.response;
    for (const part of response.candidates?.[0]?.content.parts || []) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
  } catch (e) {
    console.warn("Direct image generation failed, falling back to dynamic placeholder", e);
  }

  // Fallback with clean, non-branded keywords
  const cleanPrompt = imagePrompt.replace(/LinkedIn|Logos|Branding/gi, '');
  const keywords = encodeURIComponent(cleanPrompt.split(' ').slice(0, 3).join(','));
  const seed = Math.abs(imagePrompt.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0));
  return `https://loremflickr.com/1200/630/${keywords || 'abstract,business'}?lock=${seed % 1000}`;
};
