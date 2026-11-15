# extensions.gnome.org — dossier de soumission (préparé le 15 novembre 2026)

Rien ici n'est envoyé : ce dossier rassemble ce qu'il faut pour l'upload, à
faire depuis le navigateur de l'utilisateur (compte EGO `jg__`).

## Wi-Fi Bands 0.1 (première soumission)

1. Dépôt GitHub public : son URL est dans `metadata.json`.
2. `./pack.sh` → `wifi-bands@griffit.gmail.com.shell-extension.zip`, puis
   `shexli --format text <zip>` (voir plus bas pour le faux positif).
3. Upload du zip sur https://extensions.gnome.org/upload/ (cocher les deux
   cases : licence compatible, conditions acceptées).
4. Sur la fiche créée :
   - icône : `docs/icon/wifi-bands-256.png`, des arcs Wi-Fi au-dessus d'une
     pilule coupée en deux « 5 | 2.4 » (source : `wifi-bands.svg`) ;
   - capture : `docs/ego/screenshot.png` (le menu Wi-Fi avec les pilules et
     l'entrée Band ouverte ; noms de réseaux de voisins visibles : à flouter ou
     à refaire si l'auteur préfère).
5. Description : celle de `extension/metadata.json`, reprise automatiquement.
6. Commentaire auteur à poster dès la première revue, en anglais (brouillon à
   relire et adapter par l'auteur, qui décide de ce qu'il affirme) :

> Wi-Fi Bands adds, in the Wi-Fi menu of Quick Settings, a small pill per
> network showing its bands, and a Band entry to choose Auto, 5 GHz or 2.4 GHz
> for the network in use and optionally stay on one access point. It reads and
> changes the profile through libnm (gi://NM); it runs no command and adds
> nothing to the top bar.
>
> Points a reviewer may ask about: (1) it reaches
> `Main.panel.statusArea.quickSettings._network._wirelessToggle` to place its
> entry under the list of networks and to add a pill to each row, and reads
> `row.network`, `row._selectedIcon` and `row._label` on the rows of that list.
> There is no public API for this; every access is guarded, the extension does
> nothing if they are missing, and disable() puts the check mark back and
> destroys everything it added. (2) It creates its own NM.Client, with a
> Gio.Cancellable cancelled in disable(); no callback runs after disable().
> (3) A band change is committed to the profile in use and the connection is
> reactivated; if it is not connected the way it asked within 25 s, the previous
> values are put back. The pending change is kept in GSettings so that it is
> still checked after a disable() (a locked screen), and its profile is found by
> UUID, never through the active connection. (4) shexli reports EGO-M-004 on
> shell-version containing "51": a false positive of the analyser, the machine
> runs GNOME Shell 51.0.
> [Sentence on AI assistance, to be written by the author.]

## Réponses attendues des relecteurs

- Accès privés au Shell : listés ci-dessus, gardés, restitués dans `disable()`.
- Sous-processus : aucun. Réseau : aucun hors NetworkManager.
- Pas de `session-modes` `unlock-dialog` : le changement en attente survit à un
  `disable()` par GSettings.
- « AI-generated » : à l'auteur de répondre honnêtement sur l'outil utilisé et
  sur sa relecture.
