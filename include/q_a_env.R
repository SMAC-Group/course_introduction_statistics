render_q_a_env <- function(opts) {

  
  ix <- which(names(opts) == "answer")
  if (length(ix) == 0) {
    stop("The question has no correct answer")
  }
  
  # Separate values and feedback
  if (is.list(opts)) {
    values <- vapply(opts, function(o) o$value, character(1))
    feedbacks <- vapply(opts, function(o) o$feedback, character(1))
  } else {
    values <- opts
    feedbacks <- rep("", length(opts))
  }
  
  # Encode special characters
  values2 <- gsub("\'", "&apos;", values, fixed = TRUE)
  values2 <- gsub("\\\\\\((.*?)\\\\\\)", "\\\\(\\1\\\\)", values2)  
  
  qname <- paste0("radio_", paste(sample(LETTERS, 10, T), collapse = ""))
  
  
  # just add backslashes to values of question, not fededback, 
  values3 = add_backslashes(values2)
  options <- mapply(function(val, fb, nm) {
    sprintf(
      '<label><input type="radio" autocomplete="off" name="%s" value="%s" data-feedback="%s"></input> <span>%s</span></label>',
      qname, nm, fb, val
    )
  }, values3, feedbacks, names(opts), SIMPLIFY = TRUE)
  
  html <- paste0(
    "<div class='webex-radiogroup' id='", qname, "'>",
    paste(options, collapse = ""),
    "<div class='webex-feedback-box'></div>",
    "</div>\n"
  )
  res = html

  return(cat(res))
}







add_backslashes <- function(input_string) {
  # Use regular expressions to replace single backslashes with double backslashes
  result <- gsub("\\\\", "\\\\\\\\", input_string)
  return(result)
}






make_alert_button <- function(message, type = c("hint2", "explanation")) {
  type <- match.arg(type)
  
  # Escape single quotes and backslashes for JS onclick
  safe_message <- gsub("\\\\", "\\\\\\\\", message)  # double all backslashes
  safe_message <- gsub("'", "\\\\'", safe_message)   # escape single quotes
  
  button_label <- if (type == "hint2") "❓ Hint" else "💡 Explanation"
  
  html <- sprintf(
    '<button class="custom-button %s" onclick="toggleAlert(event, \'%s\', \'%s\')">%s</button>
<div class="alert alert-info" style="display: none;">
  <strong class="alertType"></strong>: <span class="alertMessage"></span>
</div>',
    type, safe_message, type, button_label
  )
  
  return(cat(html))
}


small_v_space_html = function(v_space_px=4){
  cat(paste0('<div style="margin-top:',v_space_px,'px;"></div>'))
}


# AI Help button - opens chat with question context
make_ai_help_button <- function(question, hint = "", explanation = "", correct_answer = "") {
  # Escape for JavaScript
  escape_js <- function(text) {
    text <- gsub("\\\\", "\\\\\\\\", text)
    text <- gsub("'", "\\\\'", text)
    text <- gsub("\n", " ", text)
    text
  }

  q_safe <- escape_js(question)
  h_safe <- escape_js(hint)
  e_safe <- escape_js(explanation)
  a_safe <- escape_js(correct_answer)

  html <- sprintf(
    '<button class="custom-button ai-help" onclick="openAIHelp(\'%s\', \'%s\', \'%s\', \'%s\')" title="Poser une question a l\'assistant IA">
      🤖 Aide IA
    </button>',
    q_safe, h_safe, e_safe, a_safe
  )

  return(cat(html))
}


