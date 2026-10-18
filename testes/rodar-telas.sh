# Sobe o servidor limpo, roda uma bateria de telas e derruba o servidor.
for t in "$@"; do
  node servidor-teste.mjs > servidor.log 2>&1 &
  PID=$!
  for i in $(seq 1 20); do curl -s localhost:3998/teste/contador >/dev/null && break; sleep 1; done
  echo "== $t"; node "$t" > saida.txt 2>&1; grep -v "^OK" saida.txt; echo "verificações OK: $(grep -c "^OK" saida.txt)"
  kill $PID 2>/dev/null; wait $PID 2>/dev/null
  for p in $(netstat -ano | grep -E ":399[89] .*LISTENING" | awk '{print $NF}' | sort -u); do taskkill //PID $p //F >/dev/null 2>&1; done
done
