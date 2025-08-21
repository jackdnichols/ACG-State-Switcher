console.log("Content script is running!");

const domainMap = {
  // Author
  "author-p149839-e1583596.adobeaemcloud.com": "Production",
  "author-p149839-e1583546.adobeaemcloud.com": "Stage 1",
  "author-p149839-e1583595.adobeaemcloud.com": "QA 1",
  "author-p149839-e1544194.adobeaemcloud.com": "Dev 1",
  
  // Web
  "acg.aaa.com": "Production",
  "www.acg.aaa.com": "Production", 
  "stage1.acg.aaa.com": "Stage 1",
  "www.stage1.acg.aaa.com": "Stage 1",
  "qa1.acg.aaa.com": "QA 1",
  "www.qa1.acg.aaa.com": "QA 1",  
  "dev1.acg.aaa.com": "Dev 1",
  "www.dev1.acg.aaa.com": "Dev 1",
  "dev.acg.aaa.com": "Dev",
  "www.dev.acg.aaa.com": "Dev",
};

const host = window.location.host;
const environment = domainMap[host];

if (environment) {
  const envDiv = document.createElement('div');
  envDiv.innerHTML = `
    <span id="close-button">&times;</span>
    Environment: ${environment}
  `;
  envDiv.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    background-color: #f0f0f0;
    border: 1px solid #ccc;
    padding: 5px 10px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    color: #333;
    z-index: 9999;
    border-radius: 5px;
    cursor: move;
    user-select: none;
    padding-right: 25px; /* Add space for the close button */
  `;
  document.body.appendChild(envDiv);

  const closeButton = document.getElementById('close-button');
  closeButton.style.cssText = `
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    font-weight: bold;
    color: #888;
  `;

  // Dragging logic
  let isDragging = false;
  let offsetX, offsetY;

  envDiv.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - envDiv.getBoundingClientRect().left;
    offsetY = e.clientY - envDiv.getBoundingClientRect().top;
    envDiv.style.right = 'auto';
    envDiv.style.bottom = 'auto';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    envDiv.style.left = `${e.clientX - offsetX}px`;
    envDiv.style.top = `${e.clientY - offsetY}px`;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Close button logic
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevents drag from being triggered
    envDiv.remove();
  });
}