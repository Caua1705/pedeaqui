if (matchMedia('(min-width:961px) and (hover:hover)').matches) {
    document.querySelectorAll('.flow-card').forEach(card => {
      card.addEventListener('mousemove', e => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5;
        const y = (e.clientY - r.top) / r.height - .5;
        card.style.transform = `translateY(-4px) rotateY(${x * 4}deg) rotateX(${-y * 3}deg)`;
      });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; });
    });
  }

  // O ano do rodape vem do relogio, sempre. O numero no index.html e apenas o
  // que aparece sem JS; quem manda e esta linha. Ver o comentario la.
  const anoDoRodape = document.getElementById('landingCopyYear');
  if (anoDoRodape) anoDoRodape.textContent = String(new Date().getFullYear());
