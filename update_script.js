const fs = require('fs');
let c = fs.readFileSync('main.js', 'utf8');

c = c.replace(
  "    selectEl.innerHTML = \"\";\r\n    timelineMetaMap.clear();",
  "    selectEl.innerHTML = \"\";\r\n    timelineMetaMap.clear();\r\n\r\n    const defaultOpt = document.createElement(\"option\");\r\n    defaultOpt.value = \"\";\r\n    defaultOpt.textContent = \"Select Timeline\";\r\n    selectEl.appendChild(defaultOpt);"
);

c = c.replace(
  "    if (!idToSelect) {\r\n      idToSelect = firstTimelineId;\r\n    }\r\n\r\n    if (idToSelect) {\r\n      selectEl.value = idToSelect;\r\n      return idToSelect;\r\n    }",
  "    if (idToSelect) {\r\n      selectEl.value = idToSelect;\r\n      return idToSelect;\r\n    } else {\r\n      selectEl.value = \"\";\r\n      return null;\r\n    }"
);

fs.writeFileSync('main.js', c, 'utf8');
console.log('Update script successful!');

