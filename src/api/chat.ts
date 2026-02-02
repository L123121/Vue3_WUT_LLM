const API_URL = '/api';

export const sendMessageToBackend = async (
  message: string,
  history: { role: string; content: string }[] = []
): Promise<string> => {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        history
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.data.reply || "抱歉，我没有收到回复。";
  } catch (error) {
    console.error("Chat API Error:", error);
    throw error;
  }
};