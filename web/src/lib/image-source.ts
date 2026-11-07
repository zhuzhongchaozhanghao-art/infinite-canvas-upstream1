// R2 public image responses may omit CORS headers. Read their bytes through
// the same-origin route provided by Vercel, Vite and the Docker web server.
export function imageSourceUrl(url: string) {
    const match = /^https:\/\/(pub-[a-f0-9]{32})\.r2\.dev\/(generated\/[^#]*)$/i.exec(url);
    return match ? `/image-source/${match[1]}/${match[2]}` : url;
}
