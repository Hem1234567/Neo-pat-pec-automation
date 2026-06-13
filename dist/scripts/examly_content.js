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

async function askGemini(prompt) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['geminiApiKey'], async (result) => {
            const apiKey = result.geminiApiKey;
            if (!apiKey) {
                alert("Gemini API Key missing! Please add it in the extension popup to use Test Automation.");
                resolve(null);
                return;
            }
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.1 }
                    })
                });
                const data = await response.json();
                if (data.candidates && data.candidates[0].content.parts[0].text) {
                    let ans = data.candidates[0].content.parts[0].text.trim();
                    ans = ans.replace(/```/g, ''); // strip markdown blocks if any
                    resolve(ans);
                } else {
                    resolve(null);
                }
            } catch(e) {
                console.error("Gemini API error", e);
                resolve(null);
            }
        });
    });
}

async function handleTestAutomation() {
    let testRunning = true;
    let fallbackLoopCount = 0;

    while (testRunning && window.examlyAutomationRunning) {
        if (fallbackLoopCount > 50) {
            console.log("Stuck in test loop. Exiting test.");
            break; 
        }
        fallbackLoopCount++;

        // 1. Bypass Pre-Test Modals
        const retakeBtn = document.querySelector('button.retake-btn-color, #undefinedRetake\\ Test');
        if (retakeBtn && retakeBtn.offsetParent !== null) {
            console.log("[Examly Auto] Clicking Retake Test...");
            retakeBtn.click();
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }

        const agreeBtn = document.querySelector('#tt-start-accept');
        if (agreeBtn && agreeBtn.offsetParent !== null) {
            console.log("[Examly Auto] Clicking Agree & Proceed...");
            agreeBtn.click();
            await new Promise(r => setTimeout(r, 5000));
            continue;
        }

        // 2. Are we on the question screen?
        const submitBtn = document.querySelector('#tt-header-submit');
        if (!submitBtn) {
            await new Promise(r => setTimeout(r, 2000));
            continue;
        }

        // 3. Process the Question
        // We will extract text from the entire page excluding the sidebar/header for context
        let mainContext = "";
        const playground = document.querySelector('testtaking-playground') || document.querySelector('[aria-labelledby="question-answer"]');
        if (playground) {
            mainContext = playground.innerText;
        } else {
            mainContext = document.body.innerText.substring(0, 2000); 
        }

        const radioBtns = Array.from(document.querySelectorAll('input[type="radio"], [role="radio"], .option-container'));
        
        if (radioBtns.length > 0) {
            console.log("[Examly Auto] Detected MCQ Question.");
            const prompt = `Solve this multiple-choice question. Here is the raw text of the question screen including the options:\n\n${mainContext}\n\nRespond with ONLY the exact text of the correct option. Do not explain. Do not include A, B, C, D unless the option itself is just a letter.`;
            
            const answer = await askGemini(prompt);
            console.log("[Examly Auto] Gemini Answer:", answer);

            if (answer) {
                // Try to click the element containing the exact answer text
                let clicked = false;
                const allElements = Array.from(document.querySelectorAll('*'));
                for (let el of allElements) {
                    if (el.innerText && el.innerText.trim().includes(answer.trim()) && el.children.length === 0) {
                        el.click();
                        if (el.parentElement) el.parentElement.click(); 
                        clicked = true;
                        break;
                    }
                }
                if (!clicked) {
                   console.log("[Examly Auto] Could not perfectly match text, clicking first option as fallback.");
                   if(radioBtns[0]) radioBtns[0].click();
                }
            } else {
               if(radioBtns[0]) radioBtns[0].click();
            }

            await new Promise(r => setTimeout(r, 2000));

            // 4. Navigate to Next Unattempted Question instead of relying on "Next" button
            const unattemptedQuestions = document.querySelectorAll('[aria-labelledby="not-attempted"]');
            
            if (unattemptedQuestions.length > 0) {
                console.log(`[Examly Auto] Found ${unattemptedQuestions.length} unattempted questions. Clicking the next one...`);
                unattemptedQuestions[0].click();
                await new Promise(r => setTimeout(r, 3000));
            } else {
                console.log("[Examly Auto] No unattempted questions left. Submitting Test...");
                submitBtn.click();
                await new Promise(r => setTimeout(r, 2000));
                
                // Deal with the "Type END to confirm" modal
                const confirmInputs = document.querySelectorAll('input[type="text"]');
                for (let input of confirmInputs) {
                    input.value = "END";
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                
                await new Promise(r => setTimeout(r, 1000));

                // Find the "YES" or "Submit" button in the modal
                const confirmSubmit = Array.from(document.querySelectorAll('button')).find(btn => btn.innerText && btn.innerText.trim().toUpperCase() === "YES") || document.querySelector('#confirm-submit, button.primary-btn-color:not(#tt-header-submit)');
                if (confirmSubmit) confirmSubmit.click();
                
                testRunning = false;
                await new Promise(r => setTimeout(r, 5000));
            }

        } else {
            console.log("[Examly Auto] No radio buttons found. Could be a Coding Question or loading...");
            await new Promise(r => setTimeout(r, 3000));
            
            // basic check for monaco
            if (document.querySelector('.monaco-editor')) {
                // Scrape only the left side if possible, or everything
                const leftSide = document.querySelector('.problem-statement, .description, .left-pane') || playground || document.body;
                const prompt = `Solve this coding problem in Java. Return ONLY raw valid code. No markdown blocks. Problem text:\n\n${leftSide.innerText.substring(0, 2000)}`;
                const code = await askGemini(prompt);
                if (code) {
                   const script = document.createElement('script');
                   script.textContent = `if(window.monaco){ try { window.monaco.editor.getModels()[0].setValue(\`${code.replace(/`/g, '\\`').replace(/\$/g, '\\$')}\`); }catch(e){} }`;
                   document.body.appendChild(script);
                   script.remove();
                }
                
                await new Promise(r => setTimeout(r, 2000));
                
                // Click compile/submit code if possible
                const runBtn = Array.from(document.querySelectorAll('button')).find(btn => btn.innerText && btn.innerText.includes('Run'));
                if (runBtn) runBtn.click();
                await new Promise(r => setTimeout(r, 5000));

                const unattemptedQuestions = document.querySelectorAll('[aria-labelledby="not-attempted"]');
                if (unattemptedQuestions.length > 0) {
                    console.log(`[Examly Auto] Found ${unattemptedQuestions.length} unattempted questions. Clicking the next one...`);
                    unattemptedQuestions[0].click();
                    await new Promise(r => setTimeout(r, 3000));
                } else {
                    console.log("[Examly Auto] No unattempted questions left. Submitting Test...");
                    submitBtn.click();
                    await new Promise(r => setTimeout(r, 2000));
                    
                    const confirmInputs = document.querySelectorAll('input[type="text"]');
                    for (let input of confirmInputs) {
                        input.value = "END";
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    
                    await new Promise(r => setTimeout(r, 1000));

                    const confirmSubmit = Array.from(document.querySelectorAll('button')).find(btn => btn.innerText && btn.innerText.trim().toUpperCase() === "YES") || document.querySelector('#confirm-submit, button.primary-btn-color:not(#tt-header-submit)');
                    if (confirmSubmit) confirmSubmit.click();
                    
                    testRunning = false;
                    await new Promise(r => setTimeout(r, 5000));
                }
            }
        }
    }
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
      let isTest = false;

      while (!currentVideoState.found && waitLoops < 20) {
          if (!window.examlyAutomationRunning) return;
          
          window.postMessage({ action: 'play_and_monitor_video' }, '*');
          document.querySelectorAll('iframe').forEach(f => {
              try { f.contentWindow.postMessage({ action: 'play_and_monitor_video' }, '*'); } catch(e){}
          });
          
          // Check if this module is actually a test page!
          const testAcceptBtn = document.querySelector('#tt-start-accept, #undefinedRetake\\ Test, #tt-header-submit');
          if (testAcceptBtn) {
              isTest = true;
              break;
          }

          await new Promise(r => setTimeout(r, 1000));
          
          if (currentVideoState.found && currentVideoState.src === previousVideoSrc) {
              currentVideoState.found = false; 
          }
          waitLoops++;
      }
      
      if (isTest) {
          console.log("[Examly Auto] Test Interface detected! Launching Test Automation...");
          await handleTestAutomation();
          await new Promise(r => setTimeout(r, 3000)); // Buffer before clicking next module
          continue;
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
