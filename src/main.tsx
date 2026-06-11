import { createRoot } from "react-dom/client"
import App from "./App"

if ("scrollRestoration" in history) history.scrollRestoration = "manual"

// No <StrictMode>: the WebGL pipeline classes own GPU resources + window
// listeners; dev double-mount would double-init the renderer pipeline.
createRoot(document.getElementById("root")!).render(<App />)
