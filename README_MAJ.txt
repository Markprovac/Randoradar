Rando Radar 1.10.26 — correction point rouge + fiche glissable

À remplacer dans le dépôt GitHub :
- package.json
- www/app.js
- www/index.html
- www/styles.css
- www/sw.js

Corrections :
- le point rouge du profil altimétrique utilise maintenant le même type de marqueur DOM que le point GPS bleu, compatible avec la rotation de la carte ;
- un ancien point rouge est supprimé quand on change de parcours ;
- glissement vers le bas fiabilisé sur Android/WebView : poignée/en-tête capturent le geste ;
- ouvert -> glisser bas = réduit ; réduit -> glisser bas = fermé ; glisser haut = agrandi.
