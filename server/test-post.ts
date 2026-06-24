const res = await fetch('http://localhost:5000/pages/test/resources', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'text', content: 'test', x: 100.5, y: 200.5 })
});
console.log(await res.text());
