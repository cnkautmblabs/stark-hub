import { useRegisterSW } from "virtual:pwa-register/react";

// Sem isso, um deploy novo fica "invisivel" pra quem ja tem o app aberto: o
// service worker (registerType: autoUpdate) baixa a versao nova em segundo
// plano, mas so assume o controle da aba quando ela recarrega — ate la, a
// pessoa continua vendo a versao antiga e acha que a correcao nao "pegou".
// Este banner aparece assim que a nova versao termina de baixar, com um
// botao que forca a troca + reload na hora.
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Verifica por uma versao nova a cada hora — o browser so revalida o
      // sw.js sozinho em intervalos proprios, nem sempre a tempo de um
      // deploy recente aparecer na proxima visita.
      setInterval(() => registration.update(), 60 * 60 * 1000);
    }
  });

  if (!needRefresh) return null;

  return (
    <div className="mb-pwa-update-banner" role="status">
      <span><i className="bi bi-arrow-repeat" /> Nova versao do Stark Hub disponivel.</span>
      <button type="button" onClick={() => updateServiceWorker(true)}>Atualizar agora</button>
    </div>
  );
}
