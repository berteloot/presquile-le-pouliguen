import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Without this, one throw anywhere in the tree leaves the visitor on a white
    page. The fallback keeps the practical links reachable, since someone reading
    this on the seafront still needs the tide and the bus. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Le Pouliguen Live a rencontré une erreur", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="app-error">
        <h1>Le Pouliguen Live</h1>
        <p>
          L'affichage a échoué. Rechargez la page : les données sont chargées en
          direct et une source momentanément indisponible suffit à provoquer
          l'erreur.
        </p>
        <p>
          <button type="button" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </p>
        <ul>
          <li>
            Vigilance météo :{" "}
            <a
              href="https://vigilance.meteofrance.fr"
              target="_blank"
              rel="noopener noreferrer"
            >
              vigilance.meteofrance.fr
            </a>
          </li>
          <li>
            Bus Lila Presqu'île :{" "}
            <a
              href="https://www.lilapresquile.fr"
              target="_blank"
              rel="noopener noreferrer"
            >
              lilapresquile.fr
            </a>
          </li>
          <li>
            Trains :{" "}
            <a
              href="https://www.sncf-connect.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              SNCF Connect
            </a>
          </li>
        </ul>
      </main>
    );
  }
}
