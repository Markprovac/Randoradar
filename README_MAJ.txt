Rando Radar 1.10.23

Correction du suivi visuel GPS :
- pendant une activité, le point bleu et la caméra utilisent directement le dernier point du GPS natif Android ;
- synchronisation de la position native visible toutes les 1,5 s ;
- recentrage avec setView, plus fiable avec la rotation Leaflet ;
- le GPS Web ne peut plus écraser une position native plus récente.

Comportement :
- suivi activé : point GPS centré en permanence ;
- déplacement manuel de la carte : suivi suspendu ;
- bouton ◎ : recentrage + reprise du suivi.
