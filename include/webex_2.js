<script>
window.onload = function() {
  var radiogroups = document.getElementsByClassName("webex-radiogroup");

  for (var i = 0; i < radiogroups.length; i++) {
    let group = radiogroups[i];
    let radios = group.querySelectorAll("input[type=radio]");

    radios.forEach(radio => {
      radio.addEventListener("click", function(e) {
        // Deselect if already checked
        if (this.checked && this.dataset.waschecked === "true") {
          this.checked = false;
          this.dataset.waschecked = "false";
        } else {
          // Mark all radios as not previously checked
          radios.forEach(r => r.dataset.waschecked = "false");
          this.dataset.waschecked = "true";
        }

        // Keep the same logic as before
        var checked = group.querySelector("input:checked");
        var labels = group.children;
        var feedbackBox = group.querySelector(".webex-feedback-box");

        // clear option styles
        for (var j = 0; j < labels.length; j++) {
          labels[j].classList.remove("webex-correct", "webex-incorrect");
        }

        // clear feedback styles
        feedbackBox.classList.remove("correct-feedback", "incorrect-feedback");

        if (checked && checked.value === "answer") {
          checked.parentElement.classList.add("webex-correct");
          feedbackBox.classList.add("correct-feedback");
        } else if (checked) {
          checked.parentElement.classList.add("webex-incorrect");
          feedbackBox.classList.add("incorrect-feedback");
        }

        // show feedback
        if (checked) {
          feedbackBox.innerHTML = checked.dataset.feedback || "";
          feedbackBox.style.display = "block";
          if (window.MathJax) MathJax.typesetPromise([feedbackBox]);
        } else {
          feedbackBox.style.display = "none";
        }
      });
    });
  }
}
</script>



<script>
function toggleAlert(event, message, type) {
  var alertBox = event.target.nextElementSibling; // Select the alert box next to the clicked button
  var alertMessage = alertBox.querySelector(".alertMessage");
  var alertType = alertBox.querySelector(".alertType");

  if (alertBox.style.display === "block") {
    alertBox.style.display = "none"; // Hide the alert box if it's already visible
  } else {
    alertMessage.innerHTML = message;
    alertType.innerHTML = (type === 'hint2') ? '❓ Hint' : '💡 Explanation';

    // Change style based on type (yellow for hint, green for explanation)
    alertBox.style.backgroundColor = (type === 'hint2') ? '#FFEDA3' : '#C0EDC2';  
    alertBox.style.borderColor = (type === 'hint2') ? '#E5B800' : '#388E3C';  
    alertBox.style.display = "block";  // Show the alert

    MathJax.typesetPromise([alertMessage]);  // Re-render math with MathJax v3
  }
}
</script>
