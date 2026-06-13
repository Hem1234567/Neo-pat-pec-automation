console.log("Examly Automation Extension Loaded - Fix 17 (YouTube Overlay & Aggressive Tracking)");

const isTopFrame = window === window.top;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isTopFrame) return; 
  if (request.action === 'start_automation') {
    if (window.examlyAutomationRunning) {
      sendResponse({ status: "Automation is already running!" });
    } else {
      window.examlyAutomationRunning = true;
      startExamlyAutomation();
      sendResponse({ status: "Automation started!" });
    }
  } else if (request.action === 'inspect_page') {
    sendResponse({ status: "No need, we got it!" });
  }
  return true;
});

let currentVideoState = { found: false, finished: false, src: "" };

window.addEventListener('message', async (event) => {
  // IFRAME & TOP FRAME VIDEO LOGIC
  if (event.data && event.data.action === 'play_and_monitor_video') {
     // Aggressively click ANY custom play buttons or overlays even before the video tag is found
     const exactPlayBtn = document.querySelector('button[data-play-button="true"], .vjs-big-play-button, [aria-label="Play"], .play-button, #play0, .youtube .play-button');
     
     const video = document.querySelector('video');
     if (video) {
        if (!video.dataset.examlyTracked) {
            video.dataset.examlyTracked = "true";
            
            const markFinished = () => {
                if (video.dataset.examlyFinished) return;
                video.dataset.examlyFinished = "true";
                try { video.pause(); } catch(e) {} 
                try { window.top.postMessage({ action: 'video_finished_playing', src: video.currentSrc || video.src }, '*'); } catch(e){}
            };

            video.addEventListener('ended', markFinished);
            video.addEventListener('timeupdate', () => {
                if (video.duration && video.currentTime >= video.duration - 0.5) {
                    markFinished();
                }
            });
        }

        try { video.muted = true; } catch(e){}
        
        if (video.paused && !video.dataset.examlyFinished) {
            if (exactPlayBtn) exactPlayBtn.click();
            video.play().catch(e=>{});
        }
        
        try { 
            if(video.playbackRate < 2.0) video.playbackRate = 16.0; 
        } catch(e){}
        
        try {
            window.top.postMessage({ 
                action: 'video_found', 
                src: video.currentSrc || video.src
            }, '*');
        } catch(e) {}
     } else {
         // If no video tag is found yet, just click the overlay to try and trigger it to load!
         if (exactPlayBtn) {
             try { exactPlayBtn.click(); } catch(e){}
         }
     }
  }

  // TOP FRAME RECEIVER LOGIC
  if (isTopFrame && event.data) {
       if (event.data.action === 'video_found') {
           currentVideoState.found = true;
           currentVideoState.src = event.data.src;
       }
       if (event.data.action === 'video_finished_playing') {
           console.log("[Examly Auto] Received FINISHED signal from video!");
           currentVideoState.finished = true;
       }
   }
});

async function expandAllFolders() {
    console.log("[Examly Auto] Checking for closed folders...");
    let clickedAny = false;
    let modpointers = Array.from(document.querySelectorAll('.modpointer'));
    
    for (let el of modpointers) {
        const txt = el.textContent || "";
        if (!txt.includes("Start :")) {
            const img = el.querySelector('img[src*="arrow"], img[alt*="arrow"]');
            if (img && !img.src.includes('down') && !img.alt.includes('down')) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.click();
                clickedAny = true;
                await new Promise(r => setTimeout(r, 1500)); 
            }
        }
    }
    if (clickedAny) await expandAllFolders();
}

async function startExamlyAutomation() {
  alert("Automation starting! Added support for YouTube and 3rd party embedded videos.");

  await expandAllFolders();

  function getModuleElements() {
    const all = Array.from(document.querySelectorAll('*'));
    const startElements = all.filter(el => el.textContent && el.textContent.includes("Start :"));
    const deepestStart = startElements.filter(m => !startElements.some(other => m !== other && m.contains(other)));
    
    const actualModules = deepestStart.map(el => {
        let card = el;
        for(let i=0; i<3; i++) {
            if (card.parentElement && card.parentElement.tagName !== 'BODY') card = card.parentElement;
        }
        return card;
    });
    
    const unique = [...new Set(actualModules)];
    unique.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return unique;
  }

  const initialModules = getModuleElements();
  const totalModules = initialModules.length;
  
  if (totalModules === 0) {
    alert("Could not detect any video modules.");
    window.examlyAutomationRunning = false;
    return;
  }

  console.log(`[Examly Auto] Found ${totalModules} modules to process.`);

  for (let i = 0; i < totalModules; i++) {
      if (!window.examlyAutomationRunning) return;
      
      let currentModules = getModuleElements();
      if (i >= currentModules.length) {
          await expandAllFolders();
          currentModules = getModuleElements();
          if (i >= currentModules.length) break; 
      }
      
      let mod = currentModules[i];
      console.log(`[Examly Auto] Explicitly clicking module ${i + 1} from the sidebar...`);
      
      mod.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 1000));
      
      mod.click();
      const clickables = mod.querySelectorAll('*');
      if (clickables.length > 0) clickables[0].click(); 

      // Click any immediate custom play overlays right after module load
      setTimeout(() => {
          const overlays = document.querySelectorAll('.play-button, #play0, .youtube .play-button, img[src*="play"]');
          overlays.forEach(btn => { try { btn.click(); } catch(e){} });
      }, 2000);

      currentVideoState.found = false;
      currentVideoState.finished = false;
      let previousVideoSrc = currentVideoState.src;
      
      let waitLoops = 0;
      while (!currentVideoState.found && waitLoops < 20) {
          if (!window.examlyAutomationRunning) return;
          
          window.postMessage({ action: 'play_and_monitor_video' }, '*');
          document.querySelectorAll('iframe').forEach(f => {
              try { f.contentWindow.postMessage({ action: 'play_and_monitor_video' }, '*'); } catch(e){}
          });
          
          await new Promise(r => setTimeout(r, 1000));
          
          if (currentVideoState.found && currentVideoState.src === previousVideoSrc) {
              currentVideoState.found = false; 
          }
          waitLoops++;
      }
      
      if (!currentVideoState.found) {
          console.log("[Examly Auto] No video detected for this module after 20 seconds. Skipping to next.");
          continue;
      }
      
      console.log(`[Examly Auto] Video active! Waiting for it to finish ONCE...`);
      
      let safetyTimeout = 600; 
      let loops = 0;
      
      while (!currentVideoState.finished && loops < safetyTimeout) {
          if (!window.examlyAutomationRunning) return;
          
          currentModules = getModuleElements();
          if (i < currentModules.length) {
              currentModules[i].style.outline = "4px solid #ff00ff";
              currentModules[i].style.boxShadow = "0 0 15px #ff00ff";
          }

          window.postMessage({ action: 'play_and_monitor_video' }, '*');
          document.querySelectorAll('iframe').forEach(f => {
              try { f.contentWindow.postMessage({ action: 'play_and_monitor_video' }, '*'); } catch(e){}
          });
          
          await new Promise(r => setTimeout(r, 1000));
          loops++;
      }
      
      console.log(`[Examly Auto] Video successfully finished!`);
      
      currentModules = getModuleElements();
      if (i < currentModules.length) {
          currentModules[i].style.outline = "none";
          currentModules[i].style.boxShadow = "none";
      }
      
      await new Promise(r => setTimeout(r, 3000));
  }

  alert("Automation finished! No more videos detected.");
  window.examlyAutomationRunning = false;
}
