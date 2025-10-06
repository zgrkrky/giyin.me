/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality, SafetySetting, HarmCategory, HarmBlockThreshold } from "@google/genai";

// Backend base URL (Render'da env'den gelir, localde 3001'e düşer)
const API_BASE =
  (import.meta as any).env?.VITE_API_URL ||
  (import.meta as any).env?.VITE_API_BASE_URL || // eski isimle set ettiyseniz yedek
  'http://localhost:3001';


const fileToPart = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
};

const dataUrlToParts = (dataUrl: string) => {
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    return { mimeType: mimeMatch[1], data: arr[1] };
}

const dataUrlToPart = (dataUrl: string) => {
    const { mimeType, data } = dataUrlToParts(dataUrl);
    return { inlineData: { mimeType, data } };
}
// HTTP(S) bir görseli indir → backend proxy üzerinden al → data URL'e çevir → inlineData döndür
async function httpUrlToPart(url: string) {
  // CORS'a takılmamak için backend proxy'yi kullanıyoruz
  const res = await fetch(`${API_BASE}/proxy-download?url=${encodeURIComponent(url)}&filename=source.png`);
  if (!res.ok) throw new Error(`Image proxy fetch failed: ${res.status}`);

  const blob = await res.blob();

  // FileReader ile güvenli data URL üret (stack overflow yok)
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  const { mimeType, data } = dataUrlToParts(dataUrl);
  return { inlineData: { mimeType, data } };
}



const handleApiResponse = (response: GenerateContentResponse): string => {
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
        throw new Error(errorMessage);
    }

    // Find the first image part in any candidate
    for (const candidate of response.candidates ?? []) {
        const imagePart = candidate.content?.parts?.find(part => part.inlineData);
        if (imagePart?.inlineData) {
            const { mimeType, data } = imagePart.inlineData;
            return `data:${mimeType};base64,${data}`;
        }
    }

    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Image generation stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`;
        throw new Error(errorMessage);
    }
    const textFeedback = response.text?.trim();
    const errorMessage = `The AI model did not return an image. ` + (textFeedback ? `The model responded with text: "${textFeedback}"` : "This can happen due to safety filters or if the request is too complex. Please try a different image.");
    throw new Error(errorMessage);
};

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY as string });
const model = 'gemini-2.5-flash-image-preview';

// --- Fallback'li güvenli istek helper'ı ---
async function generateWithFallback(
  parts: any[],
  primaryPrompt: string,
  fallbackPrompt: string
): Promise<string> {
  try {
    const res1 = await ai.models.generateContent({
      model,
      contents: { parts: [...parts, { text: primaryPrompt }] },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });
    return handleApiResponse(res1);
  } catch (e: any) {
    console.warn('[try-on primary failed] retrying with safer prompt:', e?.message || e);
    const res2 = await ai.models.generateContent({
      model,
      contents: { parts: [...parts, { text: fallbackPrompt }] },
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });
    return handleApiResponse(res2);
  }
}


// --- GÜVENLİK AYARLARI ---
const safetySettings: SafetySetting[] = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE }, // <-- Burası çok önemli
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_UNSPECIFIED, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export const generateModelImage = async (userImage: File): Promise<string> => {
    const userImagePart = await fileToPart(userImage);
    const prompt = "You are an expert fashion photographer AI. Keep and maintain the person’s exact face, expression, and body proportions from the original image. Do not beautify, slim, or reshape any part of the face or body. Maintain the same weight and physical proportions. Only reframe the body into a standing full-body shot studio posture. Transform this image into a full-body, photorealistic fashion model shot suitable for a premium e-commerce website. Place the model against a clean, neutral studio backdrop (light gray, #f0f0f0) with soft, even lighting. Do not idealize or alter the figure. Adjust the posture slightly into a natural full-body stance — relaxed, confident, and fashion-oriented. Keep all current clothing and accessories, making them appear well-lit and professional. The final image must look real, elegant, and high-quality for fashion retail use.";
const response = await ai.models.generateContent({
    model,
    contents: { parts: [userImagePart, { text: prompt }] },
    config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
    },
});
    return handleApiResponse(response);
};


export const generateVirtualTryOnImage = async (modelImageUrl: string, garmentImage: File): Promise<string> => {
    const modelImagePart = modelImageUrl.startsWith('data:')
  ? dataUrlToPart(modelImageUrl)
  : await httpUrlToPart(modelImageUrl);

const garmentImagePart = await fileToPart(garmentImage);

    const prompt = `You are an expert virtual try-on AI. Your task is to realistically dress a person (Image 1) with a new garment (Image 2).

**Crucial Rules:**
1.  **Identify Garment Type:** First, analyze the garment in Image 2. Is it a top (shirt, blouse), a bottom (pants, skirt), or a full-body item (dress, jumpsuit)?
2.  **Complete Garment Replacement:**
    * If the new garment is a **full-body item (like a dress)**, you MUST completely REMOVE and REPLACE **ALL** existing clothing on the person (both top and bottom).
    * If the new garment is a **top**, only replace the upper body clothing.
    * If the new garment is a **bottom**, only replace the lower body clothing.
    No part of the original, replaced clothing should be visible.
3.  **Preserve the Person:** The person's face, hair, skin tone, body shape, and pose from Image 1 MUST remain unchanged.
4.  **Preserve the Background:** The entire background from Image 1 MUST be preserved perfectly.
5.  **Realistic Application:** The garment must be realistically adapted to the person's pose, with natural folds, shadows, and lighting consistent with the original scene.
6.  **Output Format:** Your output MUST be ONLY the final, edited image. Do not include any text, descriptions, or explanations.`;
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [modelImagePart, garmentImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};

export const generatePoseVariation = async (tryOnImageUrl: string, poseInstruction: string): Promise<string> => {
    const tryOnImagePart = tryOnImageUrl.startsWith('data:')
  ? dataUrlToPart(tryOnImageUrl)
  : await httpUrlToPart(tryOnImageUrl);

    const prompt = `You are an expert fashion photographer AI. Take this image and regenerate it from a different perspective. The person, clothing, and background style must remain identical. The new perspective should be: "${poseInstruction}". Return ONLY the final image.`;
    const response = await ai.models.generateContent({
        model,
        contents: { parts: [tryOnImagePart, { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    return handleApiResponse(response);
};
//... Diğer fonksiyonlarınızın bittiği yerin altına bunu ekleyin ...

export const uploadOriginalImage = async (file: File) => {
  const formData = new FormData();
  formData.append('user_image', file);

  try {
    const response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Sunucuya yüklenemedi. Durum: ${response.status}, Mesaj: ${errorText}`);
    }
    const result = await response.json();
    console.log('Orijinal resim yükleme sonucu:', result.message);
  } catch (error) {
    console.error('Orijinal resim yüklenirken bir hata oluştu:', error);
  }
};

export const uploadGarment = async (file: File): Promise<string> => {
  console.log('[geminiService] uploadGarment called:', file.name);

  const formData = new FormData();
  formData.append('garment_image', file);

  const response = await fetch(`${API_BASE}/upload-garment`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kıyafet yüklenemedi. Durum: ${response.status}, Mesaj: ${errorText}`);
  }

  const result = await response.json();
  if (!result?.url) throw new Error('Sunucu URL döndürmedi.');
  return result.url; // signed URL
};

export const uploadGeneratedImage = async (imageBase64: string): Promise<string> => {
  const response = await fetch(`${API_BASE}/upload-generated`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageData: imageBase64 }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Generated image upload failed: ${text}`);
  }

  const result = await response.json();
  console.log('[uploadGeneratedImage] Uploaded URL:', result.url);
  return result.url; // signed URL
};


