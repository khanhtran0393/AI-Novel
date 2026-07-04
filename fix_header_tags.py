import re

filepath = 'src/app/workspace/components/Header.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the broken closing tag section
broken_ending = """                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Modals from Sidebar */}"""

fixed_ending = """                </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Modals from Sidebar */}"""

content = content.replace(broken_ending, fixed_ending)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Applied fix 1")
