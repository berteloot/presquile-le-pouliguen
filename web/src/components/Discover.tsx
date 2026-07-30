import NearbyTowns from "./NearbyTowns";

export default function Discover() {
  return (
    <main className="discover">
      <NearbyTowns />

      <section className="card card-wide">
        <div className="event-heading">
          <h3>Les incontournables</h3>
          <span className="discover-source-note">sélection famille</span>
        </div>
        <div className="must-see-grid">
          <article className="must-see-card">
            <strong>Manège, niniches et jeux du port</strong>
            <p>
              Le classique du Pouliguen avec les enfants : un tour de manège,
              les jeux sur la promenade, puis une niniche en regardant le port.
            </p>
            <a
              href="https://rando.loire-atlantique.fr/service/189486-Manege-Magic-Mickey"
              target="_blank"
              rel="noopener noreferrer"
            >
              repère promenade du Port
            </a>
          </article>
          <article className="must-see-card">
            <strong>La criée du Croisic</strong>
            <p>
              Pour les produits de la mer et l'ambiance port de pêche : soles,
              langoustines, crevettes roses, bars, coquilles Saint-Jacques selon
              les arrivages et la saison.
            </p>
            <a
              href="https://lecroisic.fr/fr/rb/384867/port-de-peche-criee"
              target="_blank"
              rel="noopener noreferrer"
            >
              port de pêche et criée
            </a>
          </article>
          <article className="must-see-card">
            <strong>Canopy Parc</strong>
            <p>
              Une parenthèse fraîche à deux pas du Pouliguen : filets suspendus,
              passerelles et jeux dans les arbres, pratique quand la plage tape
              trop fort.
            </p>
            <a href="https://www.canopyparc.com/accueil" target="_blank" rel="noopener noreferrer">
              réserver ou vérifier les horaires
            </a>
          </article>
        </div>
      </section>

      <section className="card card-wide">
        <h3>Un port devenu station balnéaire</h3>
        <p>
          Le Pouliguen est d'abord un village de pêcheurs et de paludiers,
          installé le long de l'étier qui relie les marais salants à la mer.
          Son nom viendrait du breton, souvent traduit par « la petite anse
          blanche ». Au XIXe siècle, l'arrivée des bains de mer puis du chemin
          de fer transforme le bourg : les villas s'alignent face à la baie,
          les pins remplacent les dunes, et Le Pouliguen devient l'une des
          premières stations balnéaires de la côte.
        </p>
        <p>
          Aujourd'hui la commune compte environ 4 200 habitants à l'année,
          et plus de six logements sur dix sont des résidences secondaires :
          l'été, la ville change complètement de visage.
        </p>
      </section>

      <section className="card card-wide">
        <h3>Les marais salants, mille ans de sel</h3>
        <p>
          Juste derrière Le Pouliguen s'étendent les marais salants de
          Guérande, exploités depuis plus d'un millénaire. L'eau de mer entre
          par les traicts, circule de bassin en bassin et se concentre sous
          l'effet du soleil et du vent, jusqu'aux œillets où le paludier
          récolte le gros sel et la fameuse fleur de sel, cueillie à la
          surface de l'eau les soirs d'été.
        </p>
        <p>
          Le métier de paludier se transmet encore, avec des outils dont la
          forme n'a presque pas changé. En saison, plusieurs maisons du sel et
          des paludiers indépendants proposent des visites au départ de
          Guérande, de Batz-sur-Mer ou du Croisic.
        </p>
      </section>

      <section className="card card-wide">
        <h3>La Côte Sauvage et la grotte des Korrigans</h3>
        <p>
          De la pointe de Penchâteau jusqu'au Croisic, la Côte Sauvage aligne
          falaises, criques et grottes marines. La plus célèbre côté
          Pouliguen est la grotte des Korrigans : la légende locale en fait le
          refuge de ces petits êtres malicieux du folklore breton. Elle se
          découvre à marée basse, en surveillant l'heure de la marée
          montante.
        </p>
        <p>
          À Penchâteau, la chapelle Sainte-Anne-et-Saint-Julien, construite
          pour l'essentiel au XVe siècle, est classée monument historique
          depuis 1925. La croix de Penchâteau et un ancien camp gaulois,
          repéré sur la pointe, rappellent que le site est occupé depuis
          l'Antiquité.
        </p>
      </section>

      <section className="card card-wide">
        <h3>Hors des sentiers battus</h3>
        <ul className="discover-list">
          <li>
            <strong>L'anse de Toulain à marée basse.</strong> Une plage
            accessible seulement quand la mer se retire, au départ du sentier
            côtier de la Côte Sauvage.
          </li>
          <li>
            <strong>Le bois du Pouliguen.</strong> Un parc boisé en plein
            centre, avec ses expositions d'été et ses allées ombragées, rare
            sur cette côte.
          </li>
          <li>
            <strong>Le tour des marais à vélo.</strong> Les circuits balisés
            traversent les salines entre Guérande, Saillé et Batz-sur-Mer :
            partez tôt le matin quand la lumière est rasante.
          </li>
          <li>
            <strong>Le port à la remontée de la marée.</strong> L'étier
            s'anime quand les bateaux rentrent avec le flot, côté quai
            Jules-Sandeau.
          </li>
          <li>
            <strong>La Micro-Folie.</strong> Un musée numérique gratuit qui
            projette les collections des grands musées nationaux, avec des
            casques de réalité virtuelle.
          </li>
        </ul>
      </section>

      <section className="card card-wide">
        <h3>Le saviez-vous ?</h3>
        <ul className="discover-list">
          <li>
            Le port du Pouliguen est partagé avec La Baule : la limite entre
            les deux communes passe dans l'étier.
          </li>
          <li>
            La baie que borde la plage du Nau fait partie de la grande baie
            dite « de La Baule », l'une des plus longues plages de sable
            d'Europe.
          </li>
          <li>
            Les marais salants voisins font partie d'un ensemble de zones
            humides reconnu d'importance internationale pour les oiseaux.
          </li>
          <li>
            L'été, le marché nocturne du mercredi soir est devenu l'un des
            rendez-vous les plus fréquentés de la commune.
          </li>
        </ul>
        <p className="meta-line">
          Sources principales : INSEE (dossier communal), base Mérimée du
          ministère de la Culture, Cap Atlantique, office de tourisme La
          Baule-Guérande. Contenu vérifié en juillet 2026.
        </p>
      </section>
    </main>
  );
}
