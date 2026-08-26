Rando Radar 1.10.22 — correction du suivi carte GPS

Correction : la rotation automatique de la carte pouvait déclencher un faux dragstart Leaflet et désactiver le recentrage GPS sans geste utilisateur.

Nouveau comportement :
- le point GPS reste au centre tant que l’utilisateur ne fait pas réellement glisser la carte ;
- les rotations automatiques et mises à jour de cap ne coupent plus le suivi ;
- un vrai déplacement manuel de la carte suspend le recentrage ;
- le bouton ◎ recentre immédiatement et réactive le suivi ;
- la boussole/orientation de la 1.10.21 est conservée ;
- le GPS natif Fused de la 1.10.20 est conservé.
