// One socket for the whole page.
//
// The map and the chat both talk to the server, and both used to open their own
// connection. Two connections is two presences: the server keys who is where by
// socket, so a second one puts a second token with your name on the board and
// tells the room you arrived twice.
//
// Nothing disconnects it. It lives as long as the page does, which is the same
// life as the world it is showing.
(function () {
  let shared = null;
  window.gameSocket = () => (shared ||= io());
})();
