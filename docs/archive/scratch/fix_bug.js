const fs = require('fs');
const path = 'c:/Users/Arenapc/Desktop/PROJETOS/pedeaqui_front/junior-da-picanha.html';

function fix() {
    let content = fs.readFileSync(path);
    let text = '';
    
    // Try UTF-16LE first
    text = content.toString('utf16le');
    if (!text.includes('<html') && !text.includes('<!DOCTYPE')) {
        console.log('Not UTF-16LE, trying UTF-8...');
        text = content.toString('utf8');
    } else {
        console.log('Detected UTF-16LE');
    }

    if (!text.includes('<div class="prod-add">+</div')) {
        console.log('Could not find the broken tag. Current state might be different.');
        // Let's check for the partial tag
        if (text.includes('prod-add')) {
            console.log('Found prod-add, but not the exact broken tag.');
        } else {
            console.log('Could not find prod-add at all.');
        }
    }

    const fixed = text.replace('<div class="prod-add">+</div', '<div class="prod-add">+</div>');
    
    if (fixed === text) {
        console.log('No changes made.');
    } else {
        console.log('Fix applied!');
        fs.writeFileSync(path, fixed, 'utf8');
        console.log('File saved as UTF-8');
    }
}

fix();
