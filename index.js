let callObject;

// Log events as they are triggered to see what's happening throughout the call
const logEvent = (e) => console.log("Daily event: ", e);

/**
 *
 * OWNER-RELATED FUNCTIONS
 */

// The owner will go right into the call since they have appropriate permissions
const createOwnerCall = async ({ name, url, token }) => {
  const loading = document.getElementById("ownerLoading");
  loading.classList.remove("hide");
  // Create call object
  callObject = await window.DailyIframe.createCallObject();
  // Do *not* do this in production apps. This is to help debug in the browser console during development.
  window.callObject = callObject;

  // Add Daily event listeners (not an exhaustive list)
  // See: https://docs.daily.co/reference/daily-js/events
  callObject
    .on("joined-meeting", handleJoinedMeeting)
    .on("left-meeting", logEvent)
    .on("participant-joined", logEvent)
    .on("participant-updated", handleParticipantUpdate)
    .on("participant-left", handleParticipantLeft)
    .on("waiting-participant-added", addWaitingParticipant)
    .on("waiting-participant-updated", logEvent)
    .on("waiting-participant-removed", updateWaitingParticipant)
    .on("error", logEvent);

  // Let owner join the meeting
  try {
    await callObject.join({ userName: name, url, token });
    loading.classList.add("hide");
    // show the allow/deny buttons for anyone in the waiting room
    const buttons = document.getElementById("ownerKnockingButtons");
    buttons.classList.remove("hide");
  } catch (error) {
    console.log("Owner join failed: ", error);
    loading.classList.add("hide");
  }
};

// Handle onsubmit event for the owner form
const submitOwnerForm = (e) => {
  e.preventDefault();
  // Do not try to create new call object if it already exists
  if (callObject) return;
  // Get form values
  const name = e.target.name.value;
  const url = e.target.url.value;
  const token = e.target.token.value;
  // initialize the call object and let the owner join/enter the call
  createOwnerCall({ name, url, token });
};

/**
 *
 * GUEST-RELATED FUNCTIONS
 */

// This function will create the call object and "join" the call.
// Joining for guests means going into the lobby and waiting for an owner to let them in.
const createGuestCall = async ({ name, url }) => {
  // show loading message
  const loading = document.getElementById("guestLoading");
  loading.classList.remove("hide");

  // Show waiting room message after knocking
  const guestKnockingMsg = document.getElementById("guestKnocking");
  guestKnockingMsg.classList.remove("hide");

  // Create call object
  callObject = await window.DailyIframe.createCallObject();

  // Add Daily event listeners (not an exhaustive list)
  // See: https://docs.daily.co/reference/daily-js/events
  callObject
    .on("joined-meeting", checkAccessLevel)
    .on("left-meeting", logEvent)
    .on("participant-joined", logEvent)
    .on("participant-updated", handleParticipantUpdate)
    .on("participant-left", handleParticipantLeft)
    .on("error", handleError)
    .on("access-state-updated", handleAccessStateUpdate);

  // hide loading message
  loading.classList.add("hide");

  // Let guest preAuth, "join" the call (just the lobby in this case), and requestAccess (knock)
  try {
    // We don't actually need to call preAuth, but if you wanted to make UI decisions based on their access level (guest or owner) before joining, the response will have the access level available.
    await callObject.preAuth({ userName: name, url });
    // Join the call. If the participant is a guest, they will join the "lobby" access level and will need to knock to enter the actual call.
    await callObject.join();
    // Request full access to the call (i.e. knock to enter)
    await callObject.requestAccess({ name });
  } catch (error) {
    console.log("Owner join failed: ", error);
  }
};

const submitKnockingForm = (e) => {
  e.preventDefault();
  const name = e.target.name.value;
  const url = e.target.url.value;
  // guests have separate method to initialize the call to show the differences more clearly.
  // you could also have one form to join a call and determine if they're a guest/owner after.
  createGuestCall({ name, url });
};

/**
 *
 * VIDEO/EVENT-RELATED FUNCTIONS
 */

const checkAccessLevel = async (e) => {
  const state = await callObject.accessState();

  if (state.access.level === "lobby") {
    // Note: since tracks are available here to build a "prejoin UI", we could use this condition to show a prejoin UI.
    // that's not in the scope of this demo so we'll just return the access level in any case.
    return state.access.level;
  }
  // access level could be full (allowed to join the call) or none.
  return state.access.level;
};

const handleJoinedMeeting = (e) => {
  const participant = e?.participants?.local;
  // this demo assumes videos are on when the call starts since there aren't controls in the UI.
  // update the room's settings to enable cameras by default.
  if (!participant?.tracks?.video) {
    console.log('enable "Cameras on start" for your room');
    return;
  }
  addParticipantVideo(participant);
};

const handleParticipantUpdate = async (e) => {
  const level = await checkAccessLevel();
  console.log("current level: ", level);
  if (level === "lobby") return;
  // In a complete video call app, you would listen for different updates (e.g. toggling video/audio).
  // For now, we'll just see if a video element exists for them and add it if not.
  const participant = e?.participant;
  const vid = findVideoForParticipant(participant.session_id);
  if (!vid) {
    // No video found for participant after update. Add one.
    console.log("Adding new video");
    addParticipantVideo(participant);
  }
};

const handleParticipantLeft = (e) => {
  // In a complete video call app, you would listen for different updates (e.g. toggling video/audio).
  // For now, we'll just see if a video element exists for them and add it if not.
  const participant = e?.participant;
  const vid = findVideoForParticipant(participant.session_id);
  if (vid) {
    vid.remove();
  }
};

const addParticipantVideo = async (participant) => {
  // if the participant is an owner, we'll put them up top; otherwise, in the guest container
  let videoContainer = document.getElementById(
    participant.owner ? "ownerVideo" : "guestVideo"
  );

  let vid = findVideoForParticipant(participant.session_id);
  if (!vid && participant.video) {
    // create video element, set attributes
    vid = document.createElement("video");
    vid.session_id = participant.session_id;
    vid.style.width = "100%";
    vid.autoplay = true;
    vid.muted = true;
    vid.playsInline = true;
    // append to container (either guest or owner section)
    videoContainer.appendChild(vid);
    // set video track
    vid.srcObject = new MediaStream([participant.tracks.video.persistentTrack]);
  }
};

const findVideoForParticipant = (session_id) => {
  // find the video element with a session id that matches
  for (const vid of document.getElementsByTagName("video")) {
    if (vid.session_id === session_id) {
      return vid;
    }
  }
};

const handleAccessStateUpdate = (e) => {
  // if the access level has changed to full, the knocking participant has been let in.
  if (e.access.level === "full") {
    // add the participant's video (it will only be added if it doesn't already exist)
    const local = callObject.participants().local;
    addParticipantVideo(local);
    // Hide knocking buttons now that they're in the call
    const guestKnockingMsg = document.getElementById("guestKnocking");
    guestKnockingMsg.classList.add("hide");
  } else {
    console.log(e);
  }
};

const leaveCall = () => {
  if (callObject) {
    console.log("leaving call");
    callObject.leave();
    // todo: add .off() events: https://docs.daily.co/reference/rn-daily-js/instance-methods/off
    // todo: remove video element from DOM
  } else {
    console.log("not in a call to leave");
  }
};

/**
 *
 * KNOCKING-RELATED FUNCTIONS
 */
const allowAccess = () => {
  console.log("allow guest in");
  const waiting = callObject.waitingParticipants();

  const waitList = Object.keys(waiting);
  // we'll let the whole list in but it's more common to let a single person in.
  waitList.forEach(async (id) => {
    await callObject.updateWaitingParticipant(id, {
      grantRequestedAccess: true,
    });
  });
  // You could also use callObject.updateWaitingParticipants(*) to let everyone in at once. The example above to is show the more common example of programmatically letting people in one at a time.
};

const denyAccess = () => {
  console.log("deny guest access");
  console.log("allow guest in");
  const waiting = callObject.waitingParticipants();

  const waitList = Object.keys(waiting);
  // we'll let the whole list in but it's more common to let a single person in.
  waitList.forEach(async (id) => {
    await callObject.updateWaitingParticipant(id, {
      grantRequestedAccess: false,
    });
  });
};

const handleError = (e) => {
  logEvent(e);
  // The request to join (knocking) was rejected :(
  console.log(e.errorMsg);
  if (e.errorMsg === "Join request rejected") {
    // hide knocking message
    const guestKnockingMsg = document.getElementById("guestKnocking");
    guestKnockingMsg.classList.add("hide");
    // show rejected message
    const guestDenied = document.getElementById("guestDenied");
    guestDenied.classList.remove("hide");
  }
};

const addWaitingParticipant = (e) => {
  const list = document.getElementById("knockingList");
  const li = document.createElement("li");
  li.setAttribute("id", e.participant.id);
  li.innerHTML = `${e.participant.name}: ${e.participant.id}`;
  list.appendChild(li);
};

const updateWaitingParticipant = (e) => {
  logEvent(e);
  // get the li of the waiting participant who was removed from the list
  const id = e.participant.id;
  const li = document.getElementById(id);
  console.log("remove li", li);
  // if the li exists, remove it from the list
  if (li) {
    li.remove();
  }
};

/**
 *
 * EVENT LISTENERS
 */
const knockingForm = document.getElementById("knockingForm");
knockingForm.addEventListener("submit", submitKnockingForm);

const ownerForm = document.getElementById("ownerForm");
ownerForm.addEventListener("submit", submitOwnerForm);

const allowAccessButton = document.getElementById("allowAccessButton");
allowAccessButton.addEventListener("click", allowAccess);

const denyAccessButton = document.getElementById("denyAccessButton");
denyAccessButton.addEventListener("click", denyAccess);

const leaveButton = document.getElementById("leaveButton");
leaveButton.addEventListener("click", leaveCall);
