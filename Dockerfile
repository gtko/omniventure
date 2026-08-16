# Image du bac à sable des agents.
#
# Elle fournit un Linux complet avec Node, Bun, git et les outils de base :
# c'est l'environnement dans lequel un agent code, installe, compile et teste
# sans que votre machine soit allumée.
#
# La version doit suivre celle de @cloudflare/sandbox dans package.json.
FROM docker.io/cloudflare/sandbox:0.12.7

# Port de contrôle du bac à sable (le SDK s'y connecte).
EXPOSE 3000
