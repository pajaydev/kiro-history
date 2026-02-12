import open from 'open';

export async function openBrowser(url: string): Promise<boolean> {
  try {
    await open(url);
    return true;
  } catch (error) {
    console.error('Failed to open browser:', error);
    return false;
  }
}
