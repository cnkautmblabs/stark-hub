import React from "react";
import i18n from "../../i18n/index.js";

// Sem isso, qualquer excecao de render em QUALQUER componente derruba a
// arvore React inteira (tela em branco, sem log visivel para o usuario) —
// era exatamente o sintoma relatado ao abrir certos Work Items com formato
// de dados inesperado. Cada boundary isola o pedaco que quebrou e deixa o
// resto do app (ou, no caso do modal, o board por baixo) continuar usavel.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Stark Hub crash:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, () => this.setState({ error: null }));
    return (
      <div className="stark-error-boundary">
        <strong>{i18n.t("errorBoundary.somethingWrong")}</strong>
        <p>{this.state.error?.message || i18n.t("errorBoundary.unknownError")}</p>
        <button type="button" onClick={() => window.location.reload()}>{i18n.t("errorBoundary.reloadPage")}</button>
      </div>
    );
  }
}
